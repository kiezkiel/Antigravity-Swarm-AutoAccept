const test = require('node:test');
const assert = require('node:assert');

// Simulate the exact DOM from the user's screenshot
function createMockDOM() {
    const card = {
        className: 'border rounded-xl p-4 bg-card',
        textContent: 'Allow reading this URL?\nantigravity.google\n1  Yes, allow this time\n2  Yes, and always allow in this conversation\n3  Yes, and always allow\n4  No (tell the agent what to do instead)\nSkip\nSubmit ↵',
        clicked: []
    };

    const option1 = {
        tagName: 'DIV',
        className: 'group flex items-center gap-1 w-full text-left text-sm px-2 min-h-8 py-1 rounded-lg tabular-nums select-none cursor-pointer',
        textContent: '1  Yes, allow this time',
        click() { card.clicked.push('option1'); }
    };

    const option2 = {
        tagName: 'DIV',
        className: 'group flex items-center gap-1 w-full text-left text-sm px-2 min-h-8 py-1 rounded-lg tabular-nums select-none cursor-pointer',
        textContent: '2  Yes, and always allow in this conversation',
        click() { card.clicked.push('option2'); }
    };

    const option3 = {
        tagName: 'DIV',
        className: 'group flex items-center gap-1 w-full text-left text-sm px-2 min-h-8 py-1 rounded-lg tabular-nums select-none cursor-pointer',
        textContent: '3  Yes, and always allow',
        click() { card.clicked.push('option3'); }
    };

    const submitBtn = {
        tagName: 'BUTTON',
        className: 'btn-primary rounded-md px-3 py-1',
        textContent: 'Submit ↵',
        getAttribute(attr) { return null; },
        click() { card.clicked.push('submit'); }
    };

    return { card, option1, option2, option3, submitBtn };
}

test('handlePermissionCard logic picks option 3 (always allow) and submits', () => {
    const { card, option1, option2, option3, submitBtn } = createMockDOM();
    const options = [option1, option2, option3];

    let bestOption = null;
    let bestPriority = 999;

    for (const opt of options) {
        const cleanText = opt.textContent.toLowerCase().replace(/^[0-9\s•\-\.\(\)]+/, '').trim();
        const hasAlwaysAllow = cleanText.includes('always allow');
        const hasConversation = cleanText.includes('conversation');

        if (hasAlwaysAllow && !hasConversation) {
            if (bestPriority > 1) { bestOption = opt; bestPriority = 1; }
        } else if (hasAlwaysAllow && hasConversation) {
            if (bestPriority > 2) { bestOption = opt; bestPriority = 2; }
        } else if (cleanText.includes('yes, allow') || cleanText.includes('allow this time') || cleanText.includes('allow')) {
            if (bestPriority > 3) { bestOption = opt; bestPriority = 3; }
        }
    }

    assert.strictEqual(bestOption, option3);
    bestOption.click();
    submitBtn.click();

    assert.deepStrictEqual(card.clicked, ['option3', 'submit']);
});
