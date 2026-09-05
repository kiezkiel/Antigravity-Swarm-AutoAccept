const test = require('node:test');
const assert = require('node:assert');
const { ConnectionManager } = require('../src/cdp/ConnectionManager');

test('ConnectionManager tracks sessions and pause state', () => {
    const cm = new ConnectionManager({
        getPort: () => 9333,
        getConfig: () => ({ blockedCommands: ['rm -rf'] })
    });

    assert.strictEqual(cm.isConnected, false);
    assert.strictEqual(cm.isPaused, false);
    assert.strictEqual(cm.swarmPaused, false);

    cm.setPauseState(true, true);
    assert.strictEqual(cm.isPaused, true);
    assert.strictEqual(cm.swarmPaused, true);

    const status = cm.getStatus();
    assert.strictEqual(status.isPaused, true);
    assert.strictEqual(status.swarmPaused, true);
    assert.strictEqual(status.sessionCount, 0);

    cm.dispose();
});
