const WebSocket = require('ws');

async function main() {
    const ws = new WebSocket('ws://127.0.0.1:9333/devtools/page/9550A9DE69F23FE230DE064A990850F9');
    await new Promise(r => ws.on('open', r));

    const expr = `
        (function() {
            var titlebar = document.getElementById('workbench.parts.titlebar');
            if (!titlebar) return 'no titlebar';
            var items = Array.from(titlebar.querySelectorAll('*')).filter(el => (el.textContent || '').trim() === 'Run');
            return items.map(el => ({
                tag: el.tagName,
                role: el.getAttribute('role'),
                className: el.className,
                outer: el.outerHTML
            }));
        })()
    `;

    ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true }
    }));

    ws.on('message', m => {
        const res = JSON.parse(m.toString());
        console.log(JSON.stringify(res.result?.result?.value, null, 2));
        process.exit(0);
    });
}

main().catch(console.error);
