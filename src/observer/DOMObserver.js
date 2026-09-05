/**
 * Antigravity Swarm AutoAccept — In-Page DOM Observer
 * High-performance, event-driven observer injected into Antigravity agent webviews.
 * Handles Run, Accept, Always Allow, Retry, and interactive tool permission cards (e.g. "Allow reading this URL?").
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
        'yes, and always allow',
        'yes, and always allow in this conversation',
        'yes, allow this time',
        'yes, allow',
        'allow',
        ...(autoRetryEnabled ? ['retry', 'continue'] : []),
        ...customTexts.map(t => String(t).trim().toLowerCase()).filter(Boolean)
    ];

    const expandKeywords = ['requires input', 'expand'];

    return `
(function() {
    if (window.__AA_OBSERVER_ACTIVE) {
        // Re-run immediate scan on re-injection
        try { scanAndAccept(); } catch(e) {}
        return 'already-active';
    }
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
    var COOLDOWN_MS = 3000;
    var EXPAND_COOLDOWN_MS = 6000;

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

    function safeClick(el) {
        if (!el) return;
        try {
            if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded();
            else if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        } catch(e) {}

        try {
            el.focus();
            el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            el.click();
        } catch(e) {
            try { el.click(); } catch(err) {}
        }
    }

    /**
     * Specialized handler for multi-choice permission prompts (e.g. "Allow reading this URL?")
     * Selects "Yes, and always allow" (or "Yes, allow this time") and clicks "Submit".
     */
    function handlePermissionCards() {
        var submitButtons = [];
        var allButtons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
        
        for (var i = 0; i < allButtons.length; i++) {
            var b = allButtons[i];
            var rawText = (b.textContent || b.value || '').trim().toLowerCase();
            // Clean trailing return arrow or whitespace
            var clean = rawText.replace(/[\\u21B5\\u23CE\\u21A9\\u2190-\\u21FF\\s]+$/g, '');
            if (clean === 'submit' || clean.startsWith('submit')) {
                submitButtons.push(b);
            }
        }

        for (var s = 0; s < submitButtons.length; s++) {
            var submitBtn = submitButtons[s];
            if (submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true') continue;

            // Find parent permission card container
            var container = submitBtn.parentElement;
            for (var up = 0; up < 8 && container && container !== document.body; up++) {
                var cText = (container.textContent || '').toLowerCase();
                if (cText.indexOf('allow') !== -1 || cText.indexOf('permission') !== -1) {
                    break;
                }
                container = container.parentElement;
            }

            if (!container) continue;
            var containerText = (container.textContent || '').toLowerCase();

            var isPermissionPrompt = containerText.indexOf('allow reading') !== -1 ||
                                     containerText.indexOf('allow executing') !== -1 ||
                                     containerText.indexOf('allow running') !== -1 ||
                                     containerText.indexOf('allow this') !== -1 ||
                                     containerText.indexOf('yes, allow') !== -1 ||
                                     containerText.indexOf('always allow') !== -1;

            if (!isPermissionPrompt) continue;

            var cdKey = _domPath(submitBtn) + ':permission_card';
            if (clickCooldowns[cdKey] && (Date.now() - clickCooldowns[cdKey] < 4000)) continue;

            // Find options inside this card
            var candidateOptions = container.querySelectorAll('button, [role="radio"], [role="option"], [role="button"], label, div.cursor-pointer, div[class*="tabular-nums"], [class*="cursor-pointer"]');
            var bestOption = null;
            var bestPriority = 999;

            for (var o = 0; o < candidateOptions.length; o++) {
                var opt = candidateOptions[o];
                if (opt === submitBtn) continue;

                var optRaw = (opt.textContent || '').toLowerCase().trim();
                var optClean = optRaw.replace(/^[0-9\\s•\\-\\.\\(\\)]+/, '').trim();

                var hasAlwaysAllow = optClean.indexOf('always allow') !== -1;
                var hasConversation = optClean.indexOf('conversation') !== -1;

                if (hasAlwaysAllow && !hasConversation) {
                    if (bestPriority > 1) { bestOption = opt; bestPriority = 1; }
                } else if (hasAlwaysAllow && hasConversation) {
                    if (bestPriority > 2) { bestOption = opt; bestPriority = 2; }
                } else if (optClean.indexOf('yes, allow') !== -1 || optClean.indexOf('allow this time') !== -1 || optClean.indexOf('allow') !== -1) {
                    if (bestPriority > 3) { bestOption = opt; bestPriority = 3; }
                }
            }

            // Click the chosen option
            if (bestOption) {
                _log('Selecting permission option:', (bestOption.textContent || '').trim().substring(0, 50));
                safeClick(bestOption);
                var innerRadio = bestOption.querySelector('input[type="radio"], input[type="checkbox"]');
                if (innerRadio) safeClick(innerRadio);
            }

            clickCooldowns[cdKey] = Date.now();
            window.__AA_CLICK_COUNT = (window.__AA_CLICK_COUNT || 0) + 1;
            window.__AA_CLICK_LOG.push({
                text: 'Permission Approved (Submit)',
                tag: (submitBtn.tagName || '').toLowerCase(),
                time: Date.now()
            });

            _log('Auto-clicking Submit on permission prompt');
            setTimeout(function() {
                safeClick(submitBtn);
            }, 60);

            return 'clicked:permission_submit';
        }
        return null;
    }

    function isInsideListContainer(el) {
        if (!el || !el.closest) return false;
        if (el.closest(LIST_SELECTORS)) return true;

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
                return null;
            }

            var tag = (el.tagName || '').toLowerCase();
            var role = el.getAttribute ? el.getAttribute('role') : null;
            var isClickable = tag === 'button' || tag === 'a' ||
                role === 'button' || role === 'link' ||
                (el.classList && el.classList.contains('cursor-pointer')) ||
                el.onclick ||
                (el.getAttribute && el.getAttribute('tabindex') === '0');

            if (isClickable) {
                if (tag === 'button' || tag === 'a') return el;
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
            if (textContent.length === 0 || textContent.length > 70) continue;

            // Clean leading numbers (e.g. "1  Yes, allow this time") and trailing symbols
            var cleanContent = textContent.replace(/^[0-9\\s•\\-\\.\\(\\)]+/, '').replace(/[\\u21B5\\u23CE\\u21A9\\u2190-\\u21FF\\s]+$/g, '').trim();

            for (var t = 0; t < targets.length; t++) {
                if (best !== null && t >= best.priority) break;
                var target = targets[t];
                var isExpand = (target === 'expand' || target === 'requires input');
                var isMatch = false;

                if (isExpand) {
                    if (target === 'expand') {
                        isMatch = cleanContent.replace(/[^a-z]/g, '') === 'expand';
                    } else {
                        isMatch = cleanContent.indexOf('requires input') !== -1;
                    }
                } else {
                    isMatch = (cleanContent === target) ||
                        (cleanContent.startsWith(target + ' ') && cleanContent.length <= target.length * 4) ||
                        (cleanContent.startsWith(target) && /^[a-z0-9_\\-]/.test(cleanContent) === false && cleanContent.length <= target.length * 3);
                }

                if (!isMatch) continue;

                var clickable = getClosestClickable(node);
                if (!clickable) continue;

                var tag = (clickable.tagName || '').toLowerCase();
                var isSemantic = (tag === 'button' || tag === 'a');

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

                var key = _domPath(clickable) + ':' + target + ':' + cleanContent.substring(0, 20);
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

        // 1. Check for interactive permission cards first (e.g. "Allow reading this URL?")
        var permResult = handlePermissionCards();
        if (permResult) return permResult;

        // 2. Scan for standard action buttons
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
        safeClick(btn);
        return 'clicked:' + text;
    }

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
        }, 30);
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'data-state']
    });

    // 1.5s fallback polling interval
    var interval = setInterval(function() {
        if (window.__AA_PAUSED || window.__AA_SWARM_PAUSED) return;
        try { scanAndAccept(); } catch(e) {}
    }, 1500);

    window.__AA_CLEANUP = function() {
        if (observer) { observer.disconnect(); observer = null; }
        if (interval) { clearInterval(interval); interval = null; }
        window.__AA_OBSERVER_ACTIVE = false;
    };

    // Initial scan
    try { scanAndAccept(); } catch(e) {}

    return 'observer-installed';
})();
`;
}

module.exports = {
    buildDOMObserverScript
};
