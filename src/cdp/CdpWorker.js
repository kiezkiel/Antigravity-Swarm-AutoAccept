/**
 * Antigravity Swarm AutoAccept — CDP Worker Thread
 * Isolates Chrome DevTools Protocol network I/O and JSON-RPC dispatch.
 */

const { parentPort } = require('worker_threads');
const WebSocket = require('ws');

// Persistent connection pool: wsUrl -> CdpConnection
const wsPool = new Map();

class CdpConnection {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = new WebSocket(wsUrl);
        this.pending = new Map();
        this.msgId = 0;
        this._dead = false;

        this.ready = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._dead = true;
                reject(new Error('WebSocket connection timeout'));
            }, 6000);

            this.ws.on('open', () => {
                clearTimeout(timeout);
                resolve();
            });

            this.ws.on('error', (err) => {
                clearTimeout(timeout);
                this.cleanup(err);
                reject(err);
            });
        });

        this.ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.id && this.pending.has(msg.id)) {
                    const handler = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    clearTimeout(handler.timer);
                    if (msg.error) {
                        handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        handler.resolve(msg);
                    }
                }
            } catch (e) {
                // Ignore parse errors on malformed frames
            }
        });

        this.ws.on('close', () => this.cleanup(new Error('WebSocket closed')));
    }

    cleanup(err) {
        if (this._dead) return;
        this._dead = true;
        for (const handler of this.pending.values()) {
            clearTimeout(handler.timer);
            handler.reject(err || new Error('Connection terminated'));
        }
        this.pending.clear();
        wsPool.delete(this.wsUrl);
        try { this.ws.terminate(); } catch (e) {}
    }

    async send(method, params = {}, timeoutMs = 8000) {
        await this.ready;
        if (this._dead) throw new Error('CDP connection is dead');

        return new Promise((resolve, reject) => {
            const id = ++this.msgId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timeout awaiting CDP method: ${method}`));
            }, timeoutMs);

            this.pending.set(id, { resolve, reject, timer });
            try {
                this.ws.send(JSON.stringify({ id, method, params }));
            } catch (e) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(e);
            }
        });
    }
}

function getCdpConnection(wsUrl) {
    let conn = wsPool.get(wsUrl);
    if (conn && !conn._dead && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) {
        return conn;
    }
    if (conn) {
        conn.cleanup(new Error('Replacing stale connection'));
    }
    conn = new CdpConnection(wsUrl);
    wsPool.set(wsUrl, conn);
    return conn;
}

let isGlobalPaused = false;
let isSwarmPaused = false;

parentPort.on('message', async (msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'sync-pause') {
        isGlobalPaused = !!msg.isPaused;
        isSwarmPaused = !!msg.swarmPaused;
        return;
    }

    switch (msg.type) {
        case 'eval': {
            try {
                const conn = getCdpConnection(msg.wsUrl);
                const res = await conn.send('Runtime.evaluate', {
                    expression: msg.expression,
                    returnByValue: true
                }, msg.timeoutMs || 5000);
                parentPort.postMessage({ type: 'eval-result', id: msg.id, result: res });
            } catch (e) {
                parentPort.postMessage({ type: 'eval-result', id: msg.id, error: e.message });
            }
            break;
        }

        case 'cdp-raw': {
            try {
                const conn = getCdpConnection(msg.wsUrl);
                const res = await conn.send(msg.method, msg.params || {}, msg.timeoutMs || 5000);
                parentPort.postMessage({ type: 'eval-result', id: msg.id, result: res });
            } catch (e) {
                parentPort.postMessage({ type: 'eval-result', id: msg.id, error: e.message });
            }
            break;
        }

        case 'burst-inject': {
            try {
                const conn = getCdpConnection(msg.wsUrl);
                // Verify window/document exists in this target
                const check = await conn.send('Runtime.evaluate', {
                    expression: 'typeof window !== "undefined" && typeof document !== "undefined"',
                    returnByValue: true
                }, 3000);

                if (check.result?.result?.value !== true) {
                    parentPort.postMessage({ type: 'burst-inject-result', id: msg.id, targetId: msg.targetId, error: 'Target has no DOM window' });
                    break;
                }

                // Inject script
                const evalRes = await conn.send('Runtime.evaluate', {
                    expression: msg.script,
                    returnByValue: true
                }, 10000);

                const resultVal = evalRes.result?.result?.value || 'injected';
                if (msg.isPaused) {
                    await conn.send('Runtime.evaluate', { expression: 'window.__AA_PAUSED = true;' }, 2000);
                }

                parentPort.postMessage({ type: 'burst-inject-result', id: msg.id, targetId: msg.targetId, result: resultVal });
            } catch (e) {
                parentPort.postMessage({ type: 'burst-inject-result', id: msg.id, targetId: msg.targetId, error: e.message });
            }
            break;
        }

        case 'shutdown': {
            for (const conn of wsPool.values()) {
                conn.cleanup(new Error('Worker shutdown'));
            }
            wsPool.clear();
            process.exit(0);
            break;
        }
    }
});
