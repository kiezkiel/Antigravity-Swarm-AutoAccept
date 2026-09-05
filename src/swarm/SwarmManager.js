/**
 * Antigravity Swarm AutoAccept — Multi-Agent Swarm Manager
 * Autonomously discovers all active and background agents in the Agent Manager,
 * monitors status badges, and switches between conversations to auto-accept approvals.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Generate a safe per-user lockfile path
let _sysUser = 'user';
try { _sysUser = os.userInfo().username || 'user'; } catch(e) {}
const _userHash = crypto.createHash('md5').update(_sysUser).digest('hex').substring(0, 8);
const SWARM_LOCK_FILE = path.join(os.tmpdir(), `aa-swarm-active-${_userHash}.json`);

class SwarmManager {
    constructor(connectionManager, options = {}) {
        this.cm = connectionManager;
        this.log = options.log || console.log;
        this.getIdleSeconds = options.getIdleSeconds || (() => 10);
        this.getLastUserActivity = options.getLastUserActivity || (() => 0);
        this.onFleetUpdate = options.onFleetUpdate || null;
        this.onActivity = options.onActivity || null;

        this.isRunning = false;
        this.isPaused = false;
        this._loopTimer = null;
        this._knownFleet = [];
        this._pendingConversations = [];
        this._lastNavigatedTitle = null;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.log('[Swarm] Autonomous Swarm Mode started.');
        this._scheduleNextLoop(1000);
    }

    stop() {
        this.isRunning = false;
        if (this._loopTimer) {
            clearTimeout(this._loopTimer);
            this._loopTimer = null;
        }
        try {
            if (fs.existsSync(SWARM_LOCK_FILE)) fs.unlinkSync(SWARM_LOCK_FILE);
        } catch(e) {}
        this.log('[Swarm] Autonomous Swarm Mode stopped.');
    }

    pause() {
        this.isPaused = true;
        this.log('[Swarm] Autonomous Swarm Mode paused.');
    }

    resume() {
        this.isPaused = false;
        this.log('[Swarm] Autonomous Swarm Mode resumed.');
        this._scheduleNextLoop(500);
    }

    _scheduleNextLoop(delayMs = 2500) {
        if (!this.isRunning) return;
        if (this._loopTimer) clearTimeout(this._loopTimer);
        this._loopTimer = setTimeout(() => this._executeSwarmCycle(), delayMs);
    }

    async _executeSwarmCycle() {
        if (!this.isRunning) return;

        try {
            // Check cross-process pause lock
            if (this._isCrossProcessPaused()) {
                this.isPaused = true;
                this._scheduleNextLoop(4000);
                return;
            }

            if (this.isPaused || this.cm.isPaused || this.cm.swarmPaused) {
                this._scheduleNextLoop(3000);
                return;
            }

            // User Idle Guard: Do not switch conversations if the user was recently typing or clicking
            const idleThresholdMs = (this.getIdleSeconds() || 10) * 1000;
            const timeSinceActivity = Date.now() - this.getLastUserActivity();

            if (timeSinceActivity < idleThresholdMs) {
                // User is actively working, postpone navigation
                this._scheduleNextLoop(2000);
                return;
            }

            // Scan the fleet across Agent Manager and open windows
            const fleet = await this.discoverFleet();
            this._knownFleet = fleet;
            if (this.onFleetUpdate) this.onFleetUpdate(fleet);

            // Find conversations requiring action (status: 'requires_input', 'pending', 'error')
            const needsAction = fleet.filter(agent => agent.requiresAction && !agent.isActive);

            if (needsAction.length > 0) {
                const targetAgent = needsAction[0];
                this.log(`[Swarm] Agent "${targetAgent.title}" requires approval. Navigating...`);

                const navigated = await this.navigateToAgent(targetAgent);
                if (navigated) {
                    // Give DOM a moment to mount, then force immediate acceptance
                    await this._sleep(1600);
                    const acceptResult = await this._triggerImmediateAccept(targetAgent);
                    
                    if (acceptResult) {
                        this.log(`[Swarm] Auto-approved in agent "${targetAgent.title}": ${acceptResult}`);
                        if (this.onActivity) {
                            this.onActivity({
                                type: 'swarm_approval',
                                action: acceptResult,
                                target: targetAgent.title,
                                timestamp: Date.now()
                            });
                        }
                    }
                }
            }
        } catch (e) {
            this.log(`[Swarm Loop Error]: ${e.message}`);
        } finally {
            this._scheduleNextLoop(3000);
        }
    }

    /**
     * Discovers all agents in Agent Manager sidebar and across active CDP targets.
     */
    async discoverFleet() {
        const fleet = [];
        const seenTitles = new Set();

        // 1. Scrape the Agent Manager sidebar webview if connected
        const sidebarUrl = this.cm.sidebarWsUrl;
        if (sidebarUrl) {
            try {
                const sidebarScrape = await this.cm.eval(sidebarUrl, `
                    (() => {
                        var agents = [];
                        
                        // Workspace cards and conversation items
                        var cards = document.querySelectorAll('[data-workspace-card="true"]');
                        if (cards.length > 0) {
                            var globalIdx = 0;
                            for (var c = 0; c < cards.length; c++) {
                                var card = cards[c];
                                var wsName = (card.textContent || '').trim();
                                var grid = card.nextElementSibling;
                                if (!grid) continue;
                                
                                var items = grid.querySelectorAll('div[class*="select-none"][class*="cursor-pointer"], [data-testid*="convo-pill"]');
                                for (var i = 0; i < items.length; i++) {
                                    var item = items[i];
                                    var title = (item.textContent || '').trim();
                                    var itemTextLower = title.toLowerCase();
                                    
                                    // Check status badges
                                    var hasRequiresInput = itemTextLower.indexOf('requires input') !== -1 ||
                                        !!item.querySelector('[aria-label*="requires input"]') ||
                                        !!item.querySelector('[class*="badge-warning"]');
                                    
                                    var isRunning = itemTextLower.indexOf('running') !== -1 ||
                                        !!item.querySelector('.codicon-loading');

                                    var isActive = item.classList.contains('active') ||
                                        item.getAttribute('aria-selected') === 'true' ||
                                        item.getAttribute('data-state') === 'active';

                                    agents.push({
                                        index: globalIdx++,
                                        title: title.replace(/requires input|running/gi, '').trim() || ('Agent ' + globalIdx),
                                        workspace: wsName || 'Default Workspace',
                                        requiresAction: hasRequiresInput,
                                        isRunning: isRunning,
                                        isActive: isActive,
                                        source: 'manager'
                                    });
                                }
                            }
                        } else {
                            // Fallback for flat convo-pill lists
                            var pills = document.querySelectorAll('[data-testid*="convo-pill"], [class*="convo-pill"], [class*="conversation-item"]');
                            for (var p = 0; p < pills.length; p++) {
                                var pill = pills[p];
                                var pillTitle = (pill.textContent || '').trim();
                                var pLower = pillTitle.toLowerCase();
                                var reqAction = pLower.indexOf('requires input') !== -1 || pLower.indexOf('action') !== -1;
                                var pRunning = pLower.indexOf('running') !== -1;
                                var pActive = pill.classList.contains('active') || pill.getAttribute('aria-selected') === 'true';

                                agents.push({
                                    index: p,
                                    title: pillTitle.replace(/requires input|running/gi, '').trim() || ('Agent ' + (p + 1)),
                                    workspace: 'Agent Manager',
                                    requiresAction: reqAction,
                                    isRunning: pRunning,
                                    isActive: pActive,
                                    source: 'manager'
                                });
                            }
                        }
                        return JSON.stringify(agents);
                    })()
                `, 4000);

                const parsed = JSON.parse(sidebarScrape?.result?.value || '[]');
                if (Array.isArray(parsed)) {
                    for (const a of parsed) {
                        fleet.push(a);
                        seenTitles.add(a.title);
                    }
                }
            } catch (e) {
                // Ignore sidebar scrape failure
            }
        }

        // 2. Add individual editor / chat tabs from active CDP sessions
        for (const [targetId, session] of this.cm.sessions) {
            if (session.type === 'page' && !seenTitles.has(session.title)) {
                fleet.push({
                    index: fleet.length,
                    title: session.title,
                    workspace: 'Individual Window',
                    requiresAction: false,
                    isRunning: true,
                    isActive: true,
                    source: 'window',
                    wsUrl: session.wsUrl,
                    targetId
                });
                seenTitles.add(session.title);
            }
        }

        return fleet;
    }

    /**
     * Navigates to a specific conversation within the Agent Manager webview.
     */
    async navigateToAgent(agent) {
        const sidebarUrl = this.cm.sidebarWsUrl;
        if (!sidebarUrl || agent.index === undefined) return false;

        try {
            const navResult = await this.cm.eval(sidebarUrl, `
                (() => {
                    var targetIdx = ${agent.index};
                    
                    // Strategy 1: Expand workspace card if collapsed and click item
                    var cards = document.querySelectorAll('[data-workspace-card="true"]');
                    var count = 0;
                    for (var c = 0; c < cards.length; c++) {
                        var card = cards[c];
                        var grid = card.nextElementSibling;
                        if (!grid) continue;
                        var items = grid.querySelectorAll('div[class*="select-none"][class*="cursor-pointer"], [data-testid*="convo-pill"]');
                        for (var i = 0; i < items.length; i++) {
                            if (count === targetIdx) {
                                var isHidden = grid.offsetHeight === 0 || window.getComputedStyle(grid).display === 'none';
                                if (isHidden) {
                                    card.click();
                                }
                                items[i].scrollIntoView({ block: 'center' });
                                items[i].click();
                                return true;
                            }
                            count++;
                        }
                    }

                    // Strategy 2: Direct pill click
                    var pills = document.querySelectorAll('[data-testid*="convo-pill"], [class*="convo-pill"], [class*="conversation-item"]');
                    if (pills.length > targetIdx) {
                        pills[targetIdx].scrollIntoView({ block: 'center' });
                        pills[targetIdx].click();
                        return true;
                    }

                    return false;
                })()
            `, 5000);

            const success = navResult?.result?.value === true;
            if (success) {
                this._lastNavigatedTitle = agent.title;
            }
            return success;
        } catch(e) {
            this.log(`[Swarm Navigation Error]: ${e.message}`);
            return false;
        }
    }

    /**
     * Forces an immediate DOM evaluation in the mounted agent view to accept pending prompts.
     */
    async _triggerImmediateAccept(agent) {
        const sidebarUrl = this.cm.sidebarWsUrl;
        if (!sidebarUrl) return null;

        try {
            const res = await this.cm.eval(sidebarUrl, `
                (() => {
                    var allTargets = [
                        'run', 'accept', 'accept all', 'accept step',
                        'always allow', 'allow this conversation', 'allow',
                        'retry', 'continue', 'requires input', 'expand'
                    ];

                    var buttons = document.querySelectorAll('button, a, [role="button"], .cursor-pointer');
                    for (var i = 0; i < buttons.length; i++) {
                        var btn = buttons[i];
                        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
                        var text = (btn.textContent || '').trim().toLowerCase();
                        for (var t = 0; t < allTargets.length; t++) {
                            var target = allTargets[t];
                            if (text === target || (text.startsWith(target) && text.length <= target.length * 3)) {
                                btn.click();
                                return 'clicked:' + target;
                            }
                        }
                    }
                    return null;
                })()
            `, 4000);

            return res?.result?.value || null;
        } catch(e) {
            return null;
        }
    }

    _isCrossProcessPaused() {
        try {
            if (fs.existsSync(SWARM_LOCK_FILE)) {
                const raw = fs.readFileSync(SWARM_LOCK_FILE, 'utf8');
                const lock = JSON.parse(raw);
                if (lock.paused && (Date.now() - lock.ts < 10 * 60 * 60 * 1000)) {
                    return true;
                }
            }
        } catch(e) {}
        return false;
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getFleet() {
        return this._knownFleet;
    }
}

module.exports = {
    SwarmManager
};
