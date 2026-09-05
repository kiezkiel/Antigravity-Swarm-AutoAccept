/**
 * Antigravity Swarm AutoAccept — In-Page DOM Observer
 * High-performance, event-driven observer injected into Antigravity agent webviews.
 */

function buildDOMObserverScript(options = {}) {
    const {
        customTexts = [],
        blockedCommands = [],
        allowedCommands = [],
        autoAcceptFileEdits = true,
        autoRetryEnabled = true
    } = options;

    const actionKeywords = [
        'run',
        ...(autoAcceptFileEdits ? ['accept', 'accept all', 'accept step'] : []),
        'always allow',
        'allow this conversation',
        'always allow this workspace',
        'allow',
        ...(autoRetryEnabled ? ['retry', 'continue'] : []),
        ...customTexts.map(t => String(t).trim().toLowerCase()).filter(Boolean)
    ];

    const expandKeywords = ['requires input', 'expand'];

    return `
(function() {
    if (window.__AA_OBSERVER_ACTIVE) return 'already-active';
    window.__AA_OBSERVER_ACTIVE = true;

    var ACTION_TEXTS = ${JSON.stringify(actionKeywords)};
    var EXPAND_TEXTS = ${JSON.stringify(expandKeywords)};
    var BLOCKED_COMMANDS = ${JSON.stringify(blockedCommands)};
    var ALLOWED_COMMANDS = ${JSON.stringify(allowedCommands)};
    var HAS_FILTERS = BLOCKED_COMMANDS.length > 0 || ALLOWED_COMMANDS.length > 0;

    var AMBIGUOUS_TEXTS = {
        'run': true,
        'accept': true,
        'allow': true,
        'retry': true,
        'continue': true
    };

    var LIST_SELECTORS = '[role="tree"], [role="treeitem"], [role="listbox"], [role="option"], .monaco-list, .conversation-list, .chat-list, .sidebar-list, [data-testid*="convo"], [data-testid*="trajectory"], [class*="conversation-list"], [class*="chat-history"], nav, [role="navigation"], [role="menu"]';

    window.__AA_PAUSED = false;
    window.__AA_SWARM_PAUSED = false;
    window.__AA_CLICK_COUNT = window.__AA_CLICK_COUNT || 0;
    window.__AA_CLICK_LOG = window.__AA_CLICK_LOG || [];
    window.__AA_RECOVERY_TS = [];

    var clickCooldowns = {};
    var COOLDOWN_MS = 4000;
    var EXPAND_COOLDOWN_MS = 8000;

    function _log() {
        var args = ['[SwarmAutoAccept]'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    function _domPath(el) {
        var parts = [];
        var curr = el;
        for (var i = 0; i < 4 && curr && curr !== document.body; i++) {
            var idx = 0;
            var child = curr.parentElement ? curr.parentElement.firstElementChild : null;
            while (child) {
                if (child === curr) break;
                idx++;
                child = child.nextElementSibling;
            }
            parts.unshift((curr.tagName || '') + '[' + idx + ']');
            curr = curr.parentElement;
        }
        return parts.join('/');
    }

    function isInsideListContainer(el) {
        if (!el || !el.closest) return false;
        if (el.closest(LIST_SELECTORS)) return true;

        // Structural check: cursor-pointer + select-none div in a scrollable list
        var parent = el.parentElement;
        for (var up = 0; up < 5 && parent && parent !== document.body; up++) {
            var pClass = parent.className || '';
            var isScroll = false;
            if (typeof pClass === 'string' && (pClass.indexOf('overflow-y') !== -1 || pClass.indexOf('scroll') !== -1)) {
                isScroll = true;
            }
            if (isScroll && parent.children.length >= 3) {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    function getClosestClickable(node) {
        var el = node;
        while (el && el !== document.body) {
            if (el !== node && el.matches && (function() {
                try { return el.matches(LIST_SELECTORS); } catch(e) { return false; }
            })()) {
                return null; // Don't escape out into container
            }

            var tag = (el.tagName || '').toLowerCase();
            var role = el.getAttribute ? el.getAttribute('role') : null;
            var isClickable = tag === 'button' || tag === 'a' ||
                role === 'button' || role === 'link' ||
                (el.classList && el.classList.contains('cursor-pointer')) ||
                el.onclick ||
                (el.getAttribute && el.getAttribute('tabindex') === '0');

            if (isClickable) {
                // Semantic buttons and links are always valid click targets
                if (tag === 'button' || tag === 'a') return el;
                // Divs/spans inside a list container are not action buttons
                if (isInsideListContainer(el)) return null;
                return el;
            }
            el = el.parentElement;
        }
        return node;
    }

    function extractCommand(btn) {
        try {
            var el = btn;
            for (var i = 0; i < 8 && el && el !== document.body; i++) {
                el = el.parentElement;
                if (!el) break;
                var codes = el.querySelectorAll('pre, code');
                if (codes.length > 0) {
                    var combined = '';
                    for (var j = 0; j < codes.length; j++) {
                        combined += ' ' + (codes[j].textContent || '').trim();
                    }
                    return combined.trim();
                }
            }
        } catch(e) {}
        return null;
    }

    function matchesPattern(cmd, pattern) {
        var patLower = pattern.toLowerCase().trim();
        var cmdLower = cmd.toLowerCase().trim();
        if (!patLower) return false;
        if (cmdLower === patLower) return true;

        var delimiters = ' \\t\\r\\n|;&/()[]{}"\\'\`$=<>,\\\\:';
        var idx = cmdLower.indexOf(patLower);
        while (idx !== -1) {
            var before = idx === 0 ? ' ' : cmdLower.charAt(idx - 1);
            var after = (idx + patLower.length >= cmdLower.length) ? ' ' : cmdLower.charAt(idx + patLower.length);
            if ((idx === 0 || delimiters.indexOf(before) !== -1) &&
                (idx + patLower.length >= cmdLower.length || delimiters.indexOf(after) !== -1)) {
                return true;
            }
            idx = cmdLower.indexOf(patLower, idx + 1);
        }
        return false;
    }

    function isPermitted(cmdText) {
        if (!HAS_FILTERS) return true;
        if (!cmdText) return false;

        for (var b = 0; b < BLOCKED_COMMANDS.length; b++) {
            if (matchesPattern(cmdText, BLOCKED_COMMANDS[b])) return false;
        }
        if (ALLOWED_COMMANDS.length > 0) {
            var allowed = false;
            for (var a = 0; a < ALLOWED_COMMANDS.length; a++) {
                if (matchesPattern(cmdText, ALLOWED_COMMANDS[a])) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) return false;
        }
        return true;
    }

    function findMatchingButton(root, targets) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        var node;
        var best = null;

        while ((node = walker.nextNode())) {
            if (node.shadowRoot) {
                var shadowBest = findMatchingButton(node.shadowRoot, targets);
                if (shadowBest && (best === null || shadowBest.priority < best.priority)) {
                    best = shadowBest;
                    if (best.priority === 0) return best;
                }
            }

            var testId = (node.getAttribute('data-testid') || node.getAttribute('data-action') || '').toLowerCase();
            if (testId.includes('alwaysallow') || testId.includes('always-allow')) {
                var clickableA = getClosestClickable(node);
                if (clickableA) {
                    return { node: clickableA, matchedText: 'always allow', priority: 0 };
                }
            }

            var textContent = (node.textContent || '').trim().toLowerCase();
            if (textContent.length === 0 || textContent.length > 60) continue;

            for (var t = 0; t < targets.length; t++) {
                if (best !== null && t >= best.priority) break;
                var target = targets[t];
                var isExpand = (target === 'expand' || target === 'requires input');
                var isMatch = false;

                if (isExpand) {
                    if (target === 'expand') {
                        isMatch = textContent.replace(/[^a-z]/g, '') === 'expand';
                    } else {
                        isMatch = textContent.indexOf('requires input') !== -1;
                    }
                } else {
                    isMatch = (textContent === target) ||
                        (textContent.startsWith(target + ' ') && textContent.length <= target.length * 4) ||
                        (textContent.startsWith(target) && /^[a-z0-9_\\-]/.test(textContent) === false && textContent.length <= target.length * 3);
                }

                if (!isMatch) continue;

                var clickable = getClosestClickable(node);
                if (!clickable) continue;

                var tag = (clickable.tagName || '').toLowerCase();
                var isSemantic = (tag === 'button' || tag === 'a');

                // If ambiguous single word on non-semantic element in list, skip
                if (!isSemantic && AMBIGUOUS_TEXTS[target] && isInsideListContainer(clickable)) {
                    continue;
                }

                if (clickable.disabled || clickable.getAttribute('aria-disabled') === 'true' ||
                    clickable.classList.contains('loading') || clickable.querySelector('.codicon-loading') ||
                    clickable.getAttribute('data-aa-blocked')) {
                    continue;
                }

                if (isExpand) {
                    var isExpanded = clickable.getAttribute('aria-expanded') === 'true' ||
                        clickable.getAttribute('data-state') === 'open';
                    if (isExpanded) continue;
                }

                var key = _domPath(clickable) + ':' + target + ':' + textContent.substring(0, 20);
                var cd = isExpand ? EXPAND_COOLDOWN_MS : COOLDOWN_MS;
                var lastClick = clickCooldowns[key] || 0;
                if (lastClick && (Date.now() - lastClick < cd)) continue;

                best = { node: clickable, matchedText: target, priority: t, key: key, isExpand: isExpand };
                if (t === 0) return best;
                break;
            }
        }

        return best;
    }

    function scanAndAccept() {
        if (window.__AA_PAUSED || window.__AA_SWARM_PAUSED) return null;

        var allTargets = ACTION_TEXTS.concat(EXPAND_TEXTS);
        var match = findMatchingButton(document.body, allTargets);
        if (!match) return null;

        var btn = match.node;
        var text = match.matchedText;

        // Security check for commands
        if (HAS_FILTERS && !match.isExpand) {
            var cmd = extractCommand(btn);
            if (cmd && !isPermitted(cmd)) {
                btn.setAttribute('data-aa-blocked', 'true');
                btn.style.cssText += ';background:#5c1d1d !important;opacity:0.7;cursor:not-allowed;';
                btn.textContent = '⛔ Blocked by Safety Filter';
                clickCooldowns[match.key] = Date.now() + 20000;
                _log('Blocked dangerous command:', cmd);
                return 'blocked:' + text;
            }
        }

        // Circuit breaker for Retry/Continue
        if (text === 'retry' || text === 'continue') {
            var now = Date.now();
            window.__AA_RECOVERY_TS = window.__AA_RECOVERY_TS.filter(function(ts) { return now - ts < 60000; });
            if (window.__AA_RECOVERY_TS.length >= 3) {
                _log('Circuit breaker activated: 3 retries in 60s');
                return 'circuit_breaker';
            }
            window.__AA_RECOVERY_TS.push(now);
        }

        clickCooldowns[match.key] = Date.now();
        window.__AA_CLICK_COUNT++;
        window.__AA_CLICK_LOG.push({
            text: text,
            tag: (btn.tagName || '').toLowerCase(),
            time: Date.now()
        });
        if (window.__AA_CLICK_LOG.length > 20) window.__AA_CLICK_LOG.shift();

        _log('Auto-clicking:', text, 'at', _domPath(btn));
        btn.click();
        return 'clicked:' + text;
    }

    // Cleanup previous observer if any
    if (typeof window.__AA_CLEANUP === 'function') {
        try { window.__AA_CLEANUP(); } catch(e) {}
    }

    var isQueued = false;
    var observer = new MutationObserver(function() {
        if (isQueued || window.__AA_PAUSED || window.__AA_SWARM_PAUSED) return;
        isQueued = true;
        setTimeout(function() {
            try { scanAndAccept(); } catch(e) { _log('Scan error:', e.message); }
            finally { isQueued = false; }
        }, 40);
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'data-state']
    });

    var interval = setInterval(function() {
        if (window.__AA_PAUSED || window.__AA_SWARM_PAUSED) return;
        try { scanAndAccept(); } catch(e) {}
    }, 10000);

    window.__AA_CLEANUP = function() {
        if (observer) { observer.disconnect(); observer = null; }
        if (interval) { clearInterval(interval); interval = null; }
        window.__AA_OBSERVER_ACTIVE = false;
    };

    // Initial immediate scan
    try { scanAndAccept(); } catch(e) {}

    return 'observer-installed';
})();
`;
}

module.exports = {
    buildDOMObserverScript
};
