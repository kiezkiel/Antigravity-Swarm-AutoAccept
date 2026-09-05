# 🐝 Antigravity Swarm AutoAccept

> **Full autonomous multi-agent fleet approval engine for Google's [Antigravity](https://antigravity.dev) AI coding assistant.**  
> Automatically detects all active and background agents in the Agent Manager, auto-accepts approval prompts (**Run**, **Accept**, **Always Allow**, **Retry**, **Continue**), and lets you run multi-agent swarms completely hands-free.

---

## ⚡ Why Swarm AutoAccept?

In Antigravity, the **Agent Manager** uses a single shared webview:
- Only the **currently active conversation** is mounted in the DOM.
- Background conversations waiting for permission prompts (e.g. running a terminal command or applying a file diff) sit **idle and blocked** until you manually click on them.
- If you launch 5 or 10 agents in parallel, you have to constantly tab between them to click "Run" or "Allow".

**Antigravity Swarm AutoAccept solves this:**
1. **Autonomous Fleet Detection**: Continuously discovers all agent conversations across workspaces and windows.
2. **Pending Action Identification**: Detects badges such as *"Requires input"*, *"Pending approval"*, and *"Action required"*.
3. **Background Swarm Cycling**: When the user is idle, it gracefully cycles through pending agents, clicks their approval buttons, and unblocks them.
4. **Zero Interruption**: Respects an intelligent user idle guard — it will never switch conversations while you are actively typing or editing code.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🐝 **Autonomous Swarm Mode** | Automatically cycles through background agent conversations to accept pending actions. |
| ⚡ **Deep DOM Observer** | High-performance `MutationObserver` with Shadow DOM traversal for sub-50ms reaction times. |
| 🛡️ **Command Safety Filter** | Token-boundary regex & pattern matcher to block dangerous commands (e.g. `rm -rf`, `DROP TABLE`, `git push -f`). |
| 🔄 **Error Auto-Recovery** | Automatically clicks **Retry** and **Continue** on transient errors (with a 3-strikes/minute circuit breaker). |
| 📊 **Interactive Dashboard** | Dark glassmorphic dashboard with live agent status, approval statistics, and audit feed. |
| 🔒 **100% Local & Open Source** | No remote server dependencies, no Gumroad license keys, no telemetry, no tracking. |

---

## 🚀 Getting Started

### 1. Enable Debug Mode in Antigravity (Required)

Antigravity must be started with Chrome DevTools Protocol enabled:
```bash
--remote-debugging-port=9333
```

> **Why port 9333?** Antigravity's internal browser features use port 9222 by default. Using 9333 avoids any port conflicts.

#### 🪟 Windows (Automatic 1-Click)
Use the extension's built-in command:
1. Press `Ctrl+Shift+P` in Antigravity.
2. Select **Swarm AutoAccept: Auto-Patch Antigravity Shortcut**.
3. Restart Antigravity.

*Or manually:* Right-click your Antigravity desktop shortcut → **Properties** → append `--remote-debugging-port=9333` to the **Target** field.

#### 🍎 macOS
Launch via Terminal or Automator:
```bash
open -a "Antigravity" --args --remote-debugging-port=9333
```

#### 🐧 Linux
Launch via terminal or edit your `.desktop` file:
```bash
antigravity --remote-debugging-port=9333
```

---

## 🛠️ Usage & Controls

### Status Bar Indicators

Located in the bottom-right status bar:
- `⚡ Auto: ON` / `✕ Auto: OFF` — Click to toggle global auto-acceptance.
- `▶ Swarm` / `⏸ Swarm Paused` — Shows Swarm Mode status (click or press `Ctrl+Shift+S` to toggle).
- `$(dashboard) Fleet` — Click to open the Visual Fleet Dashboard.

### Keyboard Shortcuts
- `Ctrl+Shift+S`: Pause / Resume Swarm Mode instantly.

### Extension Commands (`Ctrl+Shift+P`)
- `Swarm AutoAccept: Toggle ON/OFF`
- `Swarm AutoAccept: Toggle Swarm Multi-Agent Mode`
- `Swarm AutoAccept: Open Fleet Dashboard`
- `Swarm AutoAccept: Rescan Agent Fleet`
- `Swarm AutoAccept: Auto-Patch Antigravity Shortcut`

---

## 📊 Fleet Dashboard

Open via `Ctrl+Shift+P` → **Swarm AutoAccept: Open Fleet Dashboard** or by clicking `Fleet` in the status bar:

- **Live Fleet Table**: View all detected agents, their workspace, and real-time state (`Requires Input`, `Running`, `Active`, `Idle`).
- **One-Click Focus**: Jump directly to any agent conversation.
- **Safety Rule Manager**: Add or remove blocked terminal command patterns with live tags.
- **Approval Audit Log**: Chronological stream of every action auto-accepted across the swarm.

---

## ⚙️ Configuration Reference

Configure via Antigravity Settings (`Ctrl+,` → search `swarmAutoAccept`):

| Setting | Type | Default | Description |
|---|---|---|---|
| `swarmAutoAccept.enabled` | `boolean` | `true` | Master switch for auto-accepting approvals. |
| `swarmAutoAccept.swarmMode` | `boolean` | `true` | Enables autonomous multi-agent rotation. |
| `swarmAutoAccept.cdpPort` | `number` | `9333` | Chrome DevTools Protocol port. |
| `swarmAutoAccept.pollInterval` | `number` | `500` | DOM polling interval in milliseconds. |
| `swarmAutoAccept.swarmIdleSeconds` | `number` | `10` | Seconds of user inactivity required before Swarm navigates. |
| `swarmAutoAccept.autoAcceptFileEdits` | `boolean` | `true` | Auto-accept diffs and file edit steps. |
| `swarmAutoAccept.autoRetryEnabled` | `boolean` | `true` | Auto-click Retry / Continue on transient agent errors. |
| `swarmAutoAccept.blockedCommands` | `array` | `["rm -rf /", ...]` | Patterns of terminal commands that should never auto-run. |
| `swarmAutoAccept.allowedCommands` | `array` | `[]` | If non-empty, only commands matching these patterns will run. |
| `swarmAutoAccept.customButtonTexts` | `array` | `[]` | Custom button label strings to auto-click. |

---

## 🛡️ Safety & Security

- **Command Blocklist**: Pre-configured to prevent accidental runs of destructive commands (`rm -rf`, `DROP DATABASE`, `mkfs`, `git push --force`).
- **Circuit Breaker**: Limits error retries to 3 per minute per conversation to prevent infinite loops.
- **Strictly Local**: Runs entirely on your local machine. No keys, no tokens, and no network requests outside localhost CDP.

---

## 📦 Building from Source

```bash
# Clone the repository
git clone https://github.com/kiezkiel/Antigravity-Swarm-AutoAccept.git
cd Antigravity-Swarm-AutoAccept

# Install dependencies
npm install

# Run automated tests
npm test

# Package into a VSIX extension
npm run package
```

To install the `.vsix` in Antigravity:
1. Press `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
2. Select the generated `.vsix` file.
3. Reload Antigravity.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
