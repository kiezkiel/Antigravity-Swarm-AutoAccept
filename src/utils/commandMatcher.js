/**
 * Antigravity Swarm AutoAccept — Command Matcher Utility
 * Safely evaluates command strings against configured blocklists and allowlists.
 */

const DEFAULT_DELIMITERS = ' \t\r\n|;&/()[]{}"\'`$=<>,\\:';

/**
 * Checks if a command text matches a given pattern respecting word/token boundaries.
 * @param {string} commandText 
 * @param {string} pattern 
 * @param {string} [delimiters]
 * @returns {boolean}
 */
function matchesPattern(commandText, pattern, delimiters = DEFAULT_DELIMITERS) {
    if (!commandText || !pattern) return false;
    const cmdLower = commandText.toLowerCase().trim();
    const patLower = pattern.toLowerCase().trim();

    if (!patLower) return false;
    if (cmdLower === patLower) return true;

    let idx = cmdLower.indexOf(patLower);
    while (idx !== -1) {
        const charBefore = idx === 0 ? ' ' : cmdLower.charAt(idx - 1);
        const charAfter = (idx + patLower.length >= cmdLower.length)
            ? ' '
            : cmdLower.charAt(idx + patLower.length);

        const isPrefixBoundary = idx === 0 || delimiters.includes(charBefore);
        const isSuffixBoundary = (idx + patLower.length >= cmdLower.length) || delimiters.includes(charAfter);

        if (isPrefixBoundary && isSuffixBoundary) {
            return true;
        }
        idx = cmdLower.indexOf(patLower, idx + 1);
    }

    return false;
}

/**
 * Evaluates whether an extracted command is allowed to run.
 * Blocklist always takes precedence over allowlist.
 * @param {string|null} commandText 
 * @param {string[]} blockedCommands 
 * @param {string[]} allowedCommands 
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isCommandPermitted(commandText, blockedCommands = [], allowedCommands = []) {
    const hasBlocked = Array.isArray(blockedCommands) && blockedCommands.length > 0;
    const hasAllowed = Array.isArray(allowedCommands) && allowedCommands.length > 0;

    if (!hasBlocked && !hasAllowed) {
        return { allowed: true };
    }

    if (!commandText) {
        // If command extraction failed but filters are set, fail safe (reject)
        return { allowed: false, reason: 'Command text empty or could not be safely parsed' };
    }

    if (hasBlocked) {
        for (const pattern of blockedCommands) {
            if (matchesPattern(commandText, pattern)) {
                return { allowed: false, reason: `Matches blocked pattern: "${pattern}"` };
            }
        }
    }

    if (hasAllowed) {
        let isAllowed = false;
        for (const pattern of allowedCommands) {
            if (matchesPattern(commandText, pattern)) {
                isAllowed = true;
                break;
            }
        }
        if (!isAllowed) {
            return { allowed: false, reason: 'Command not in configured allowlist' };
        }
    }

    return { allowed: true };
}

module.exports = {
    matchesPattern,
    isCommandPermitted
};
