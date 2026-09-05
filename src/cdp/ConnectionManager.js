/**
 * Antigravity Swarm AutoAccept — CDP Connection Manager
 * Manages CDP target discovery, connection pooling, and in-page script injection.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const { buildDOMObserverScript } = require('../observer/DOMObserver');

class ConnectionManager {
    constructor(options = {}) {
        this.log = options.log || console.log;
        this.getPort = options.getPort || (() => 9333);
        this.getConfig = options.getConfig || (() => ({}));
        this.onStatusChange = options.onStatusChange || null;
        this.onActivity = options.onActivity || null;

        this.activePort = null;
        this.isConnected = false;
        this.isPaused = false;
        this.swarmPaused = false;

        this.sessions = new Map(); // targetId -> { id, title, url, wsUrl, type }
        this.injectedTargets = new Set();
        this.sidebarWsUrl = null;
        this.sidebarTargetId = null;

        this._worker = null;
        this._pendingIpc = new Map();
        this._ipcId = 0;
        this._pollTimer = null;
        this._heartbeatTimer = null;
        this._isDisposed = false;
    }

    _ensureWorker() {
        if (this._worker) return this._worker;

        const workerPath = path.join(__dirname, 'CdpWorker.js');
        this._worker = new Worker(workerPath);

        this._worker.on('message', (msg) => {
            if (!msg) return;

            if (msg.type === 'eval-result' && this._pendingIpc.has(msg.id)) {
                const handler = this._pendingIpc.get(msg.id);
                this._pendingIpc.delete(msg.id);
                clearTimeout(handler.timer);
                if (msg.error) handler.reject(new Error(msg.error));
                else handler.resolve(msg.result);
                return;
            }

            if (msg.type === 'burst-inject-result' && this._pendingIpc.has(msg.id)) {
                const handler = this._pendingIpc.get(msg.id);
                this._pendingIpc.delete(msg.id);
                clearTimeout(handler.timer);
                if (msg.error) handler.reject(new Error(msg.error));
                else handler.resolve(msg.result);
                return;
            }
        });

        this._worker.on('error', (err) => {
            this.log(`[CDP Worker Error]: ${err.message}`);
            this._worker = null;
        });

        this._worker.on('exit', () => {
            this._worker = null;
        });

        return this._worker;
    }

    async start() {
        if (this._isDisposed) return;
        this.log('[CDP] Starting Connection Manager...');

        await this._connect();

        // Polling loop for target discovery and recovery
        this._pollTimer = setInterval(() => {
            this._refreshTargets().catch((e) => {
                this.log(`[CDP Target Refresh Error]: ${e.message}`);
            });
        }, 2000);

        // Heartbeat check for click logs and active status
        this._heartbeatTimer = setInterval(() => {
            this._checkHeartbeats().catch(() => {});
        }, 4000);
    }

    async _connect() {
        const configuredPort = this.getPort();
        const port = await this._findOpenCdpPort(configuredPort);

        if (!port) {
            this.isConnected = false;
            this.activePort = null;
            if (this.onStatusChange) this.onStatusChange(this.getStatus());
            return;
        }

        this.activePort = port;
        this.isConnected = true;
        this.log(`[CDP] Connected on port ${port}`);

        await this._refreshTargets();
        if (this.onStatusChange) this.onStatusChange(this.getStatus());
    }

    async _findOpenCdpPort(basePort) {
        // Test base port first
        if (await this._pingPort(basePort)) return basePort;

        // Scan nearby candidate ports
        const candidates = [9333, 9222, 9334, 9335, 9330, 9331, 9332];
        for (const p of candidates) {
            if (p !== basePort && await this._pingPort(p)) {
                return p;
            }
        }
        return null;
    }

    _pingPort(port) {
        return new Promise((resolve) => {
            const req = http.get({
                hostname: '127.0.0.1',
                port,
                path: '/json/version',
                timeout: 800
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(!!parsed.Browser);
                    } catch(e) {
                        resolve(false);
                    }
                });
            });

            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    }

    async _refreshTargets() {
        if (!this.activePort) {
            await this._connect();
            return;
        }

        const targets = await this._fetchJson('/json');
        if (!targets) {
            this.isConnected = false;
            this.activePort = null;
            this.sessions.clear();
            if (this.onStatusChange) this.onStatusChange(this.getStatus());
            return;
        }

        const currentIds = new Set();

        for (const t of targets) {
            if (!t.webSocketDebuggerUrl) continue;
            currentIds.add(t.id);

            const isPage = t.type === 'page';
            const isWebview = t.type === 'webview' || (t.url && t.url.includes('vscode-webview'));
            const isAgentRelated = isWebview || (isPage && t.url && t.url.includes('vscode-file://'));

            if (!isAgentRelated) continue;

            if (!this.sessions.has(t.id)) {
                const sessionInfo = {
                    id: t.id,
                    title: t.title || 'Agent Target',
                    url: t.url,
                    wsUrl: t.webSocketDebuggerUrl,
                    type: t.type
                };
                this.sessions.set(t.id, sessionInfo);

                // Identify if this is the Agent Manager / Sidebar
                if (t.title && (t.title.includes('Agent') || t.title.includes('Manager') || t.url.includes('antigravity'))) {
                    this.sidebarTargetId = t.id;
                    this.sidebarWsUrl = t.webSocketDebuggerUrl;
                }

                this.log(`[CDP Target Found]: [${t.type}] ${t.title || 'Untitled'} (${t.id.substring(0, 8)})`);
                this._injectTarget(sessionInfo);
            }
        }

        // Clean up expired sessions
        for (const [id] of this.sessions) {
            if (!currentIds.has(id)) {
                this.sessions.delete(id);
                this.injectedTargets.delete(id);
            }
        }

        if (this.onStatusChange) this.onStatusChange(this.getStatus());
    }

    _fetchJson(pathname) {
        return new Promise((resolve) => {
            const req = http.get({
                hostname: '127.0.0.1',
                port: this.activePort,
                path: pathname,
                timeout: 1500
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
                });
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }

    async _injectTarget(session) {
        if (this.injectedTargets.has(session.id)) return;
        this.injectedTargets.add(session.id);

        const config = this.getConfig();
        const script = buildDOMObserverScript({
            customTexts: config.customButtonTexts || [],
            blockedCommands: config.blockedCommands || [],
            allowedCommands: config.allowedCommands || [],
            autoAcceptFileEdits: config.autoAcceptFileEdits !== false,
            autoRetryEnabled: config.autoRetryEnabled !== false
        });

        try {
            const worker = this._ensureWorker();
            const id = ++this._ipcId;
            const res = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this._pendingIpc.delete(id);
                    reject(new Error('Inject timeout'));
                }, 8000);

                this._pendingIpc.set(id, { resolve, reject, timer });
                worker.postMessage({
                    type: 'burst-inject',
                    id,
                    targetId: session.id,
                    wsUrl: session.wsUrl,
                    script,
                    isPaused: this.isPaused || this.swarmPaused
                });
            });

            this.log(`[CDP Injected]: ${session.title} -> ${res}`);
        } catch(e) {
            this.injectedTargets.delete(session.id);
            this.log(`[CDP Injection Failed]: ${session.title}: ${e.message}`);
        }
    }

    async eval(wsUrl, expression, timeoutMs = 5000) {
        const worker = this._ensureWorker();
        const id = ++this._ipcId;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingIpc.delete(id);
                reject(new Error('Evaluation timeout'));
            }, timeoutMs);

            this._pendingIpc.set(id, { resolve, reject, timer });
            worker.postMessage({
                type: 'eval',
                id,
                wsUrl,
                expression,
                timeoutMs
            });
        });
    }

    async raw(wsUrl, method, params = {}, timeoutMs = 5000) {
        const worker = this._ensureWorker();
        const id = ++this._ipcId;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingIpc.delete(id);
                reject(new Error('CDP raw dispatch timeout'));
            }, timeoutMs);

            this._pendingIpc.set(id, { resolve, reject, timer });
            worker.postMessage({
                type: 'cdp-raw',
                id,
                wsUrl,
                method,
                params,
                timeoutMs
            });
        });
    }

    async _checkHeartbeats() {
        if (!this.isConnected || this.sessions.size === 0) return;

        for (const [, session] of this.sessions) {
            try {
                const res = await this.eval(session.wsUrl, `
                    (() => {
                        var count = window.__AA_CLICK_COUNT || 0;
                        var logs = window.__AA_CLICK_LOG || [];
                        window.__AA_CLICK_LOG = [];
                        return JSON.stringify({ count: count, logs: logs });
                    })()
                `, 2000);

                const data = JSON.parse(res?.result?.value || '{}');
                if (Array.isArray(data.logs) && data.logs.length > 0) {
                    for (const logItem of data.logs) {
                        this.log(`[AutoAccept Clicked]: ${logItem.text} in ${session.title}`);
                        if (this.onActivity) {
                            this.onActivity({
                                type: 'click',
                                action: logItem.text,
                                target: session.title,
                                timestamp: logItem.time || Date.now()
                            });
                        }
                    }
                }
            } catch(e) {
                // Ignore transient heartbeat failures
            }
        }
    }

    setPauseState(isPaused, swarmPaused) {
        this.isPaused = !!isPaused;
        this.swarmPaused = !!swarmPaused;

        if (this._worker) {
            this._worker.postMessage({
                type: 'sync-pause',
                isPaused: this.isPaused,
                swarmPaused: this.swarmPaused
            });
        }

        const expr = `
            window.__AA_PAUSED = ${this.isPaused};
            window.__AA_SWARM_PAUSED = ${this.swarmPaused};
        `;

        for (const [, session] of this.sessions) {
            this.eval(session.wsUrl, expr, 2000).catch(() => {});
        }
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            port: this.activePort,
            sessionCount: this.sessions.size,
            isPaused: this.isPaused,
            swarmPaused: this.swarmPaused,
            sessions: Array.from(this.sessions.values()).map(s => ({
                id: s.id,
                title: s.title,
                type: s.type
            }))
        };
    }

    dispose() {
        this._isDisposed = true;
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        if (this._worker) {
            this._worker.postMessage({ type: 'shutdown' });
            this._worker = null;
        }
        this.sessions.clear();
    }
}

module.exports = {
    ConnectionManager
};
