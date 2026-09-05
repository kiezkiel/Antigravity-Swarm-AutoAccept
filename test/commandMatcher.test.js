const test = require('node:test');
const assert = require('node:assert');
const { matchesPattern, isCommandPermitted } = require('../src/utils/commandMatcher');

test('matchesPattern detects exact patterns', () => {
    assert.strictEqual(matchesPattern('rm -rf /', 'rm -rf /'), true);
    assert.strictEqual(matchesPattern('npm test', 'npm test'), true);
});

test('matchesPattern detects boundaries', () => {
    assert.strictEqual(matchesPattern('sudo rm -rf / && ls', 'rm -rf /'), true);
    assert.strictEqual(matchesPattern('format c:', 'format'), true);
    assert.strictEqual(matchesPattern('my_format_tool', 'format'), false);
    assert.strictEqual(matchesPattern('git push --force origin main', 'git push --force'), true);
    assert.strictEqual(matchesPattern('git push origin main', 'git push --force'), false);
});

test('isCommandPermitted respects blocklist over allowlist', () => {
    const blocked = ['rm -rf', 'drop table'];
    const allowed = ['npm run dev', 'git status'];

    assert.deepStrictEqual(isCommandPermitted('npm run dev', blocked, allowed), { allowed: true });
    assert.strictEqual(isCommandPermitted('rm -rf node_modules', blocked, allowed).allowed, false);
    assert.strictEqual(isCommandPermitted('cargo build', blocked, allowed).allowed, false); // not in allowed list
});

test('isCommandPermitted permits anything when lists are empty', () => {
    assert.strictEqual(isCommandPermitted('any command here', [], []).allowed, true);
});
