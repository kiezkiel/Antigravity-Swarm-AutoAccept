const test = require('node:test');
const assert = require('node:assert');
const { SwarmManager } = require('../src/swarm/SwarmManager');

test('SwarmManager initializes with proper defaults', () => {
    const mockCm = {
        isPaused: false,
        swarmPaused: false,
        sidebarWsUrl: null,
        sessions: new Map(),
        eval: async () => ({ result: { value: '[]' } })
    };

    const sm = new SwarmManager(mockCm, {
        getIdleSeconds: () => 10,
        getLastUserActivity: () => Date.now() - 20000
    });

    assert.strictEqual(sm.isRunning, false);
    assert.strictEqual(sm.isPaused, false);
    assert.deepStrictEqual(sm.getFleet(), []);

    sm.start();
    assert.strictEqual(sm.isRunning, true);

    sm.pause();
    assert.strictEqual(sm.isPaused, true);

    sm.resume();
    assert.strictEqual(sm.isPaused, false);

    sm.stop();
    assert.strictEqual(sm.isRunning, false);
});

test('SwarmManager discoverFleet extracts agents from CDP sessions', async () => {
    const mockSessions = new Map();
    mockSessions.set('sess-1', {
        id: 'sess-1',
        title: 'Background Agent: Build HUD',
        type: 'page',
        wsUrl: 'ws://127.0.0.1:9333/devtools/page/sess-1'
    });

    const mockCm = {
        isPaused: false,
        swarmPaused: false,
        sidebarWsUrl: null,
        sessions: mockSessions,
        eval: async () => ({ result: { value: '[]' } })
    };

    const sm = new SwarmManager(mockCm);
    const fleet = await sm.discoverFleet();

    assert.strictEqual(fleet.length, 1);
    assert.strictEqual(fleet[0].title, 'Background Agent: Build HUD');
    assert.strictEqual(fleet[0].source, 'window');
});
