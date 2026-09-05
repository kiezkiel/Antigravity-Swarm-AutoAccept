/**
 * Antigravity Swarm AutoAccept — Dashboard Provider
 * Hosts the rich visual fleet management webview.
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { patchWindowsShortcut } = require('../utils/shortcutPatcher');

class DashboardProvider {
    static get viewType() { return 'swarmAutoAccept.dashboard'; }

    constructor(context, connectionManager, swarmManager, options = {}) {
        this._context = context;
        this.cm = connectionManager;
        this.sm = swarmManager;
        this.log = options.log || console.log;
        this._panel = null;
        this._disposables = [];
        this._activityLog = [];
    }

    show() {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            this.pushState();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            DashboardProvider.viewType,
            '🐝 Swarm AutoAccept Fleet',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this._panel.webview.html = this._getHtml();

        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                await this._handleMessage(msg);
            },
            null,
            this._disposables
        );

        this._panel.onDidDispose(() => {
            this._panel = null;
            this._disposables.forEach(d => d.dispose());
            this._disposables = [];
        }, null, this._disposables);

        this.pushState();
    }

    pushActivity(activity) {
        this._activityLog.unshift(activity);
        if (this._activityLog.length > 50) this._activityLog.pop();

        if (this._panel) {
            this._panel.webview.postMessage({
                type: 'activity',
                data: activity
            });
        }
    }

    pushState() {
        if (!this._panel) return;

        const config = vscode.workspace.getConfiguration('swarmAutoAccept');
        const cdpStatus = this.cm.getStatus();
        const fleet = this.sm.getFleet();

        this._panel.webview.postMessage({
            type: 'state',
            data: {
                enabled: config.get('enabled', true),
                swarmMode: config.get('swarmMode', true),
                cdpConnected: cdpStatus.isConnected,
                cdpPort: cdpStatus.port || config.get('cdpPort', 9333),
                sessionCount: cdpStatus.sessionCount,
                isPaused: this.cm.isPaused,
                swarmPaused: this.sm.isPaused,
                fleet: fleet,
                blockedCommands: config.get('blockedCommands', []),
                allowedCommands: config.get('allowedCommands', []),
                autoAcceptFileEdits: config.get('autoAcceptFileEdits', true),
                autoRetryEnabled: config.get('autoRetryEnabled', true),
                swarmIdleSeconds: config.get('swarmIdleSeconds', 10),
                activities: this._activityLog
            }
        });
    }

    async _handleMessage(msg) {
        if (!msg || !msg.command) return;
        const config = vscode.workspace.getConfiguration('swarmAutoAccept');

        switch (msg.command) {
            case 'ready': {
                this.pushState();
                break;
            }
            case 'toggleEnabled': {
                const current = config.get('enabled', true);
                await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
                this.pushState();
                break;
            }
            case 'toggleSwarm': {
                const current = this.sm.isPaused;
                if (current) this.sm.resume();
                else this.sm.pause();
                this.pushState();
                break;
            }
            case 'updateBlockedCommands': {
                if (Array.isArray(msg.commands)) {
                    await config.update('blockedCommands', msg.commands, vscode.ConfigurationTarget.Global);
                    this.pushState();
                }
                break;
            }
            case 'patchShortcut': {
                const res = await patchWindowsShortcut(config.get('cdpPort', 9333));
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showWarningMessage(res.message);
                }
                break;
            }
            case 'rescan': {
                const fleet = await this.sm.discoverFleet();
                this.pushState();
                break;
            }
            case 'navigateAgent': {
                if (msg.agent) {
                    await this.sm.navigateToAgent(msg.agent);
                }
                break;
            }
        }
    }

    _getHtml() {
        const htmlPath = path.join(__dirname, 'dashboard.html');
        if (fs.existsSync(htmlPath)) {
            return fs.readFileSync(htmlPath, 'utf8');
        }
        return `<!DOCTYPE html><html><body>Error loading dashboard.html</body></html>`;
    }
}

module.exports = {
    DashboardProvider
};
