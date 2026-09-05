/**
 * Antigravity Swarm AutoAccept — Extension Entrypoint
 * Full autonomous multi-agent fleet approval engine for Antigravity.
 */

const vscode = require('vscode');
const { ConnectionManager } = require('./cdp/ConnectionManager');
const { SwarmManager } = require('./swarm/SwarmManager');
const { DashboardProvider } = require('./dashboard/DashboardProvider');
const { patchWindowsShortcut, getLaunchInstructions } = require('./utils/shortcutPatcher');

let connectionManager = null;
let swarmManager = null;
let dashboardProvider = null;
let lastUserActivity = Date.now();

// Status Bar Items
let statusBarAuto = null;
let statusBarSwarm = null;
let statusBarDashboard = null;

function log(...args) {
    console.log('[SwarmAutoAccept]', ...args);
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    log('Activating Antigravity Swarm AutoAccept...');

    const config = vscode.workspace.getConfiguration('swarmAutoAccept');
    let isAutoEnabled = config.get('enabled', true);
    let isSwarmEnabled = config.get('swarmMode', true);

    // Track user activity to prevent Swarm from stealing focus while user is working
    const updateActivity = () => { lastUserActivity = Date.now(); };
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateActivity),
        vscode.window.onDidChangeTextEditorSelection(updateActivity),
        vscode.workspace.onDidChangeTextDocument(updateActivity)
    );

    // Initialize Connection Manager
    connectionManager = new ConnectionManager({
        log,
        getPort: () => vscode.workspace.getConfiguration('swarmAutoAccept').get('cdpPort', 9333),
        getConfig: () => ({
            blockedCommands: vscode.workspace.getConfiguration('swarmAutoAccept').get('blockedCommands', []),
            allowedCommands: vscode.workspace.getConfiguration('swarmAutoAccept').get('allowedCommands', []),
            customButtonTexts: vscode.workspace.getConfiguration('swarmAutoAccept').get('customButtonTexts', []),
            autoAcceptFileEdits: vscode.workspace.getConfiguration('swarmAutoAccept').get('autoAcceptFileEdits', true),
            autoRetryEnabled: vscode.workspace.getConfiguration('swarmAutoAccept').get('autoRetryEnabled', true)
        }),
        onStatusChange: (status) => {
            updateStatusBars(status);
            if (dashboardProvider) dashboardProvider.pushState();
        },
        onActivity: (activity) => {
            if (dashboardProvider) dashboardProvider.pushActivity(activity);
        }
    });

    // Initialize Swarm Manager
    swarmManager = new SwarmManager(connectionManager, {
        log,
        getIdleSeconds: () => vscode.workspace.getConfiguration('swarmAutoAccept').get('swarmIdleSeconds', 10),
        getLastUserActivity: () => lastUserActivity,
        onFleetUpdate: (fleet) => {
            if (dashboardProvider) dashboardProvider.pushState();
        },
        onActivity: (activity) => {
            if (dashboardProvider) dashboardProvider.pushActivity(activity);
        }
    });

    // Initialize Dashboard Provider
    dashboardProvider = new DashboardProvider(context, connectionManager, swarmManager, { log });

    // Setup Status Bar
    setupStatusBar(context);

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('swarmAutoAccept.toggle', async () => {
            isAutoEnabled = !isAutoEnabled;
            await config.update('enabled', isAutoEnabled, vscode.ConfigurationTarget.Global);
            connectionManager.setPauseState(!isAutoEnabled, swarmManager.isPaused);
            updateStatusBars(connectionManager.getStatus());
            vscode.window.showInformationMessage(
                isAutoEnabled ? '⚡ Swarm AutoAccept: Enabled' : '✕ Swarm AutoAccept: Disabled'
            );
        }),

        vscode.commands.registerCommand('swarmAutoAccept.toggleSwarm', async () => {
            if (swarmManager.isPaused) {
                swarmManager.resume();
                vscode.window.showInformationMessage('🐝 Swarm Multi-Agent Mode: Resumed');
            } else {
                swarmManager.pause();
                vscode.window.showInformationMessage('⏸ Swarm Multi-Agent Mode: Paused');
            }
            connectionManager.setPauseState(!isAutoEnabled, swarmManager.isPaused);
            updateStatusBars(connectionManager.getStatus());
        }),

        vscode.commands.registerCommand('swarmAutoAccept.dashboard', () => {
            dashboardProvider.show();
        }),

        vscode.commands.registerCommand('swarmAutoAccept.scanAgents', async () => {
            const fleet = await swarmManager.discoverFleet();
            vscode.window.showInformationMessage(`Fleet scan complete: ${fleet.length} active agents detected.`);
            dashboardProvider.pushState();
        }),

        vscode.commands.registerCommand('swarmAutoAccept.patchShortcut', async () => {
            const port = config.get('cdpPort', 9333);
            if (process.platform === 'win32') {
                const res = await patchWindowsShortcut(port);
                if (res.success) {
                    vscode.window.showInformationMessage(res.message);
                } else {
                    vscode.window.showWarningMessage(res.message);
                }
            } else {
                vscode.window.showInformationMessage(getLaunchInstructions(port));
            }
        })
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('swarmAutoAccept')) {
                const updatedConfig = vscode.workspace.getConfiguration('swarmAutoAccept');
                isAutoEnabled = updatedConfig.get('enabled', true);
                isSwarmEnabled = updatedConfig.get('swarmMode', true);

                connectionManager.setPauseState(!isAutoEnabled, !isSwarmEnabled);
                if (isSwarmEnabled && !swarmManager.isRunning) swarmManager.start();
                else if (!isSwarmEnabled && swarmManager.isRunning) swarmManager.stop();

                updateStatusBars(connectionManager.getStatus());
                if (dashboardProvider) dashboardProvider.pushState();
            }
        })
    );

    // Start CDP Connection and Swarm Mode
    await connectionManager.start();
    if (isSwarmEnabled) {
        swarmManager.start();
    }

    log('Antigravity Swarm AutoAccept activated successfully ✓');
}

function setupStatusBar(context) {
    // 1. AutoAccept Global Toggle
    statusBarAuto = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarAuto.command = 'swarmAutoAccept.toggle';
    context.subscriptions.push(statusBarAuto);

    // 2. Swarm Mode Status
    statusBarSwarm = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    statusBarSwarm.command = 'swarmAutoAccept.toggleSwarm';
    context.subscriptions.push(statusBarSwarm);

    // 3. Dashboard Shortcut
    statusBarDashboard = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    statusBarDashboard.command = 'swarmAutoAccept.dashboard';
    statusBarDashboard.text = '$(dashboard) Fleet';
    statusBarDashboard.tooltip = 'Open Swarm AutoAccept Fleet Dashboard';
    context.subscriptions.push(statusBarDashboard);

    updateStatusBars();
    statusBarDashboard.show();
}

function updateStatusBars(status = {}) {
    const config = vscode.workspace.getConfiguration('swarmAutoAccept');
    const isAutoEnabled = config.get('enabled', true);

    if (statusBarAuto) {
        if (isAutoEnabled) {
            statusBarAuto.text = '$(zap) Auto: ON';
            statusBarAuto.tooltip = 'Swarm AutoAccept is ACTIVE. Click to disable.';
            statusBarAuto.backgroundColor = undefined;
        } else {
            statusBarAuto.text = '$(circle-slash) Auto: OFF';
            statusBarAuto.tooltip = 'Swarm AutoAccept is DISABLED. Click to enable.';
            statusBarAuto.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        statusBarAuto.show();
    }

    if (statusBarSwarm && swarmManager) {
        if (swarmManager.isPaused) {
            statusBarSwarm.text = '$(debug-pause) Swarm Paused';
            statusBarSwarm.tooltip = 'Swarm Multi-Agent Mode is PAUSED (Ctrl+Shift+S to resume)';
            statusBarSwarm.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            statusBarSwarm.text = '$(play) Swarm';
            statusBarSwarm.tooltip = 'Swarm Multi-Agent Mode is RUNNING (Ctrl+Shift+S to pause)';
            statusBarSwarm.backgroundColor = undefined;
        }
        statusBarSwarm.show();
    }
}

function deactivate() {
    log('Deactivating Antigravity Swarm AutoAccept...');
    if (swarmManager) {
        swarmManager.stop();
        swarmManager = null;
    }
    if (connectionManager) {
        connectionManager.dispose();
        connectionManager = null;
    }
}

module.exports = {
    activate,
    deactivate
};
