# Installing offhand on Windows

offhand has two halves and both must be running:

- the **CEP panel** inside After Effects (it owns the local WebSocket and talks to ExtendScript)
- the **MCP server** your AI client launches over stdio (it dials into the panel)

The panel is per-user (`%APPDATA%`), the server is a Node script. Neither needs administrator rights.

## Requirements

| | |
| --- | --- |
| OS | Windows 10 or 11 (macOS is untested) |
| After Effects | 2023 (23.0) or newer |
| Node.js | 20 or newer — `winget install OpenJS.NodeJS.LTS` |
| AI client | anything that speaks MCP over stdio (OpenCode, Claude Desktop, …) |

## One-liner

```powershell
irm https://raw.githubusercontent.com/Flare-0/offhand/main/scripts/setup-windows.ps1 | iex
```

The script is [`scripts/setup-windows.ps1`](../scripts/setup-windows.ps1). In order it:

1. verifies Node 20+, npm, and that you are on Windows;
2. downloads `main` into `%LOCALAPPDATA%\offhand\app` (skipped when you run it from a clone);
3. runs `npm install`, `npm --prefix extension install`, `npm run build`, `npm run build:extension`;
4. runs `npm run install:cep`, which copies `extension/dist/cep` to
   `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel`;
5. sets `PlayerDebugMode = 1` under `HKCU\Software\Adobe\CSXS.9` … `CSXS.13` (unsigned panels are blocked
   otherwise);
6. prints the MCP config with your real path.

Options:

```powershell
# install somewhere else, from a specific tag
.\scripts\setup-windows.ps1 -Dir D:\tools\offhand -Ref v0.3.0

# reuse an existing build (faster, e.g. after editing docs)
.\scripts\setup-windows.ps1 -SkipBuild
```

It is safe to re-run. It copies over the previous install rather than deleting anything, and re-running
after a `git pull` is the supported update path.

## Connect your AI client

The installer prints the JSON. It looks like this:

```json
{
  "mcp": {
    "offhand": {
      "type": "local",
      "command": ["node", "C:/Users/you/AppData/Local/offhand/app/dist/cli.js"],
      "enabled": true
    }
  }
}
```

Claude Desktop uses a different wrapper (`mcpServers` instead of `mcp`):

```json
{
  "mcpServers": {
    "offhand": {
      "command": "node",
      "args": ["C:/Users/you/AppData/Local/offhand/app/dist/cli.js"]
    }
  }
}
```

`offhand-mcp` is not on npm yet, so do **not** use `npx -y offhand-mcp` — it 404s. Point at `dist/cli.js`.

## Order of operations

The server is patient: it starts with After Effects closed and retries with backoff. But the panel can only
load at After Effects startup, so use this order:

1. Install (the panel folder now exists).
2. **Restart After Effects.**
3. **Window → Extensions → offhand**. The chip should read `listening`.
4. Start/restart your MCP client so it launches the server.
5. Ask the agent to call `status` (or run `node dist/cli.js doctor`).

## Verifying

```powershell
node "$env:LOCALAPPDATA\offhand\app\dist\cli.js" doctor
```

`doctor` walks every hop and prints the first broken one:

```
offhand doctor
  server      0.3.0 (protocol 2)
  bridge.json ok  (C:\Users\you\AppData\Roaming\offhand\bridge.json)
  token       present
  panel       not connected (PANEL_NOT_RUNNING) — open Window > Extensions > offhand
  extension   installed (C:\Users\you\AppData\Roaming\Adobe\CEP\extensions\com.offhand.panel)
```

With After Effects and the panel open, the last two lines become `panel connected (listening/ready)` and the
AE version. Inside a chat, `offhand.status` returns the same diagnosis in JSON.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Panel missing from **Window → Extensions** | AE was running during install, or debug mode is off | Restart AE; check `PlayerDebugMode` under `HKCU\Software\Adobe\CSXS.13`; re-run `npm run install:cep` |
| Panel shows `idle` / `error` | Node disabled in CEP, or port bind failed | Look at the panel log; confirm `--enable-nodejs` in the generated manifest; click **Reconnect** |
| `status` says `PANEL_NOT_RUNNING` | Panel not open | Window → Extensions → offhand |
| `status` says `BRIDGE_STALE` | `bridge.json` is from a previous AE session | Click **Reconnect** in the panel, or restart AE |
| `status` says `TOKEN_MISMATCH` | Old `%APPDATA%\offhand\token` from another install | Delete `%APPDATA%\offhand\token` (or re-run the installer), then Reconnect |
| `status` says `AE_BUSY` | A modal dialog is open in After Effects | Close the dialog, retry |
| `execute` returns `EXECUTE_DISABLED` | Raw scripts are gated off | Panel → Permissions → Allow raw scripts |
| `EPERM` / symlink errors | A real folder is squatting on the extension path | Remove `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel` with AE closed, then reinstall |
| `npm run build:extension` fails on `readlink` | Same as above, plus a copy-style install | Use `npm run install:cep` (copy), not `--link`, or clear the target folder |

## Updating

```powershell
# clone installs
git pull; npm install; npm run build; npm run build:extension; npm run install:cep

# one-liner installs: re-run the one-liner, then restart After Effects
```

The MCP server is restarted by your client, not by you. After rebuilding `dist/cli.js`, restart the MCP
client (or disable/enable the server entry) or it will keep running the old process.

## Uninstalling

These steps remove files, so they are yours to run:

1. Quit After Effects.
2. Remove `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel`.
3. Remove the install folder (`%LOCALAPPDATA%\offhand\app` for one-liner installs).
4. Optionally remove state: `%APPDATA%\offhand` (token, bridge.json, settings.json, logs).
5. Remove the `offhand` entry from your MCP client config.

Nothing is installed system-wide, and no services or scheduled tasks are created.
