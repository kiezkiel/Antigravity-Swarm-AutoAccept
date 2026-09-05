/**
 * Antigravity Swarm AutoAccept — Shortcut Patcher
 * Enables Chrome DevTools Protocol (--remote-debugging-port=9333) on Antigravity shortcuts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

/**
 * Patches Windows .lnk shortcut to append --remote-debugging-port=9333
 * @param {number} port 
 * @returns {Promise<{ success: boolean, message: string, patchedPaths?: string[] }>}
 */
async function patchWindowsShortcut(port = 9333) {
    if (process.platform !== 'win32') {
        return { success: false, message: 'Windows shortcut patcher only runs on Windows.' };
    }

    return new Promise((resolve) => {
        // PowerShell script to find and update Antigravity shortcut
        const psScript = `
            $port = ${port}
            $argToAdd = "--remote-debugging-port=$port"
            $sh = New-Object -ComObject WScript.Shell
            $patched = @()

            $locations = @(
                [Environment]::GetFolderPath("Desktop"),
                [Environment]::GetFolderPath("CommonDesktopDirectory"),
                [Environment]::GetFolderPath("StartMenu"),
                [Environment]::GetFolderPath("CommonStartMenu"),
                "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
                "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
            )

            foreach ($loc in $locations) {
                if (Test-Path $loc) {
                    Get-ChildItem -Path $loc -Filter "*Antigravity*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                        try {
                            $sc = $sh.CreateShortcut($_.FullName)
                            if ($sc.Arguments -notmatch "remote-debugging-port") {
                                $sc.Arguments = ($sc.Arguments + " " + $argToAdd).Trim()
                                $sc.Save()
                                $patched += $_.FullName
                            } else {
                                $patched += "$($_.FullName) (already configured)"
                            }
                        } catch {}
                    }
                }
            }

            if ($patched.Count -gt 0) {
                $patched | ConvertTo-Json
            } else {
                "[]"
            }
        `;

        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/\r?\n/g, ' ')}"`, (err, stdout, stderr) => {
            if (err) {
                resolve({ success: false, message: `Failed to patch shortcut: ${stderr || err.message}` });
                return;
            }

            try {
                const output = stdout.trim();
                const paths = output.startsWith('[') || output.startsWith('"') ? JSON.parse(output) : [];
                const arr = Array.isArray(paths) ? paths : [paths];

                if (arr.length > 0) {
                    resolve({
                        success: true,
                        message: `Successfully configured Antigravity shortcut with port ${port}. Please restart Antigravity IDE!`,
                        patchedPaths: arr
                    });
                } else {
                    resolve({
                        success: false,
                        message: `No Antigravity shortcuts found. Please right-click your shortcut -> Properties -> append --remote-debugging-port=${port} to Target.`
                    });
                }
            } catch(e) {
                resolve({
                    success: false,
                    message: `Could not parse patch output: ${e.message}`
                });
            }
        });
    });
}

/**
 * Returns OS-specific launch instructions for CDP
 * @param {number} port 
 */
function getLaunchInstructions(port = 9333) {
    if (process.platform === 'win32') {
        return `Add --remote-debugging-port=${port} to your Antigravity shortcut Target field or launch via terminal:\n"Antigravity IDE.exe" --remote-debugging-port=${port}`;
    } else if (process.platform === 'darwin') {
        return `Launch via Terminal:\nopen -a "Antigravity" --args --remote-debugging-port=${port}`;
    } else {
        return `Edit your .desktop file or launch via terminal:\nantigravity --remote-debugging-port=${port}`;
    }
}

module.exports = {
    patchWindowsShortcut,
    getLaunchInstructions
};
