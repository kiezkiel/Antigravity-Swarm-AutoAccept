const test = require('node:test');
const assert = require('node:assert');

const EXCLUDED_SELECTORS = [
    '#workbench\\.parts\\.titlebar',
    '.part.titlebar',
    '[role="menubar"]',
    '[role="menu"]',
    '.menubar-menu-button',
    '#workbench\\.parts\\.activitybar',
    '.part.activitybar',
    '#workbench\\.parts\\.statusbar',
    '.part.statusbar',
    '.tabs-container',
    '.tab',
    '.editor-group-header',
    '.monaco-editor',
    '.view-lines',
    '.explorer-folders-view'
].join(', ');

function isIgnoredUIElement(el) {
    if (!el || !el.closest) return false;
    try {
        if (el.closest(EXCLUDED_SELECTORS)) return true;
    } catch(e) {}
    return false;
}

test('isIgnoredUIElement rejects titlebar menu items', () => {
    const titlebar = { className: 'part titlebar', closest: (sel) => sel.includes('titlebar') };
    const menubarItem = { className: 'menubar-menu-button', closest: (sel) => sel.includes('menubar') };
    const chatButton = { className: 'btn-run text-sm', closest: () => false };

    assert.strictEqual(isIgnoredUIElement(titlebar), true);
    assert.strictEqual(isIgnoredUIElement(menubarItem), true);
    assert.strictEqual(isIgnoredUIElement(chatButton), false);
});
