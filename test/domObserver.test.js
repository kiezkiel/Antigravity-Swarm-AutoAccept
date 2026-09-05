const test = require('node:test');
const assert = require('node:assert');
const { buildDOMObserverScript } = require('../src/observer/DOMObserver');

test('buildDOMObserverScript generates valid JS snippet', () => {
    const script = buildDOMObserverScript({
        customTexts: ['allow always', 'confirm action'],
        blockedCommands: ['rm -rf /', 'git push --force'],
        allowedCommands: ['npm run'],
        autoAcceptFileEdits: true,
        autoRetryEnabled: true
    });

    assert.ok(typeof script === 'string');
    assert.ok(script.includes('window.__AA_OBSERVER_ACTIVE'));
    assert.ok(script.includes('allow always'));
    assert.ok(script.includes('rm -rf /'));
    assert.ok(script.includes('confirm action'));
    assert.ok(script.includes('MutationObserver'));
});
