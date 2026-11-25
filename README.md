<p align="center">
  <img src="assets/logo.svg" alt="offhand" width="420" />
</p>

<h1 align="center">offhand</h1>

<p align="center"><strong>After Effects, at hand.</strong></p>

<p align="center">
  An MCP server for Adobe After Effects. Typed tools first, ExtendScript only when you ask for it.
</p>

---

## Install (Windows)

One command in PowerShell. No admin rights, nothing global is installed.

```powershell
irm https://raw.githubusercontent.com/Flare-0/offhand/main/scripts/setup-windows.ps1 | iex
```

It checks for Node.js 20+, downloads offhand, builds the MCP server and the After Effects panel, installs the
panel into `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel`, and turns on CEP debug mode
(`HKCU\Software\Adobe\CSXS.9-13\PlayerDebugMode = 1`) so an unsigned panel is allowed to load.

Then:

1. **Restart After Effects** (the panel only loads at startup).
2. Open **Window → Extensions → offhand**. The panel should say **listening**.
3. Add the server to your MCP client:

```json
{
  "mcp": {
    "offhand": {
      "type": "local",
      "command": ["node", "C:/Users/<you>/AppData/Local/offhand/app/dist/cli.js"],
      "enabled": true
    }
  }
}
```

The installer prints the exact path. Verify any time:

```powershell
node "$env:LOCALAPPDATA\offhand\app\dist\cli.js" doctor
```

`offhand-mcp` is **not published to npm yet**, so `npx -y offhand-mcp` will 404. Use the built `dist/cli.js`.

### From a clone (development)

```powershell
git clone https://github.com/Flare-0/offhand.git
cd offhand
npm install
npm run build
npm --prefix extension install
npm run build:extension
npm run install:cep
```

`npm run install:cep -- --link` creates a junction instead of copying, so panel rebuilds show up without
reinstalling. See [docs/install.md](docs/install.md) for the full walkthrough and troubleshooting.

## Status

`0.1.0` — a working end-to-end preview. **Phases A–D of the rewrite are complete and verified live**:
the panel hosts the bridge inside After Effects, the MCP server dials in, and the ExtendScript host is
compiled from TypeScript to ES3.

All 14 tools are implemented on both sides: `status`, `docs`, `project`, `comp`, `layer`, `property`,
`effect`, `text`, `shape`, `mask`, `render`, `assets`, `view`, and the `execute` escape hatch.

Known gaps, tracked in [ROADMAP.md](ROADMAP.md):

- Not every tool has a live smoke test on AE 2023 yet (`status`, `project`, `comp` do).
- Stable layer IDs, write diffs, a `batch` tool, `detail: min|full` and render jobs land in Phase E.
- Mac is untested; the installer is Windows-only.
- npm publish is Phase H.

## Why

Most After Effects automation hands the model a blank ExtendScript buffer. That is flexible, but it is
slow, token-hungry, and easy to get wrong. **offhand** takes the opposite approach:

- **Typed tools for the common work.** Inspect the project, find a layer, set a property, add an effect,
  animate a value, render a preview.
- **One escape hatch.** `execute` runs raw ExtendScript, requires a reason, is logged, and is **off by
  default** until you enable “Allow raw scripts” in the panel.
- **Small responses.** Compact JSON, default limits, and truncation footers instead of dumping a whole
  project.
- **Actionable errors.** “No composition named X. Call project with action=`comps` to list compositions.”
  Not a JSX stack trace. Bridge failures return a diagnosis code with a fix.
- **Real undo.** Every write tool runs inside one `app.beginUndoGroup("offhand: …")`.
- **Local by default.** The bridge binds to `127.0.0.1` and authenticates with a per-user token.

## How it works

```
MCP client  ⇐ stdio ⇒  offhand server (Node + TypeScript)
                            ⇐ WebSocket 127.0.0.1 ⇒  CEP panel inside After Effects
                                                          ⇐ evalScript ⇒ ExtendScript host (ES3)
```

The **panel owns the socket**. It listens on `127.0.0.1` (port 47823, falling back to an ephemeral port),
writes `%APPDATA%\offhand\bridge.json` with the port, token and protocol version, and serializes every
call into one queue because ExtendScript is single-threaded. The MCP server is a short-lived stdio process
that reads `bridge.json` and dials in — so several MCP clients can share one After Effects, and a panel
restart cannot orphan a port.

The protocol is versioned (currently **v2**). Instead of `connected: false`, `status` returns a
diagnosis:

| Code | Meaning | Fix |
| --- | --- | --- |
| `PANEL_NOT_RUNNING` | No `bridge.json` | Open After Effects → Window → Extensions → offhand |
| `BRIDGE_STALE` | `bridge.json` exists, nothing is listening | Click **Reconnect** in the panel, or restart AE |
| `TOKEN_MISMATCH` | Tokens disagree | Re-run the installer (it rewrites both sides' token) |
| `VERSION_MISMATCH` | Server and panel protocols differ | Update both; old `bridge.json` v1 files are rejected |
| `AE_BUSY` | A modal dialog is blocking ExtendScript | Close the dialog in After Effects, then retry |

## Tools

| Tool | Purpose |
| --- | --- |
| `status` | Bridge state, project, active comp, playhead, selection. |
| `docs` | Search the bundled AE scripting and expression reference (works offline). |
| `project` | Info, items, open, save. |
| `comp` | Create, update, list, inspect compositions. |
| `layer` | List, create, update, delete layers. |
| `property` | Get/set values, keyframes, expressions by path (`transform.position`). |
| `effect` | Search installed effects, add, configure, remove. |
| `text` | Create and edit text layers. |
| `shape` | Create and edit shape layers. |
| `mask` | Create, configure, remove masks. |
| `render` | Preview frames to PNG, queue renders. |
| `assets` | Import, organize, replace footage. |
| `view` | Open comps, set the playhead, select layers. |
| `execute` | Last-resort ExtendScript. Requires a reason; disabled by default. |

See [docs/tools.md](docs/tools.md) for schemas and examples, and [docs/recipes.md](docs/recipes.md) for
task-shaped walkthroughs.

## Security

- The bridge binds to `127.0.0.1` and requires a token stored outside the repo
  (`%APPDATA%\offhand\token`), created with exclusive-create semantics.
- Raw scripts are gated **in the panel**, not in the MCP server, so no agent can enable them over the
  bridge. While disabled, `execute` returns `EXECUTE_DISABLED` immediately and never reaches ExtendScript.
- Even enabled, the `execute` blocklist is a speed bump, not a sandbox: it has the same privileges as
  After Effects. See [docs/security.md](docs/security.md).
- Calls are logged to `%APPDATA%\offhand\logs\usage.jsonl`, including the reason for every `execute`.

## Development

```powershell
npm run dev              # rebuild the MCP server on change
npm run typecheck
npm test                 # 5 files / 24 tests
npm run lint
npm run build
npm run build:extension  # CEP panel + ES3 ExtendScript bundle
npm run doctor           # check every hop: bridge.json, port, handshake, host ping
```

The panel lives in `extension/` (bolt-cep: React + Vite + TypeScript). The ExtendScript host is
`extension/src/jsx/**/*.ts`, compiled to ES3 — no hand-written `.jsx` anymore. `extension/host/` is the
old ES3 tree, kept only as a fallback until the ported host is fully verified, and is not edited.

Project layout:

```
src/cli.ts            entry point, doctor command
src/server/           MCP stdio server, bridge client, tool registry
  bridge.ts           dial-in WebSocket client, retries, diagnosis
  tools/              one file per tool (zod schema + handler)
src/shared/           protocol v2, paths, errors, version
extension/            bolt-cep project (React panel + TS ExtendScript host)
  src/js/main/        panel UI
  src/js/bridge/      panel-side WS server, bridge.json writer, settings
  src/jsx/            ExtendScript host (compiled to ES3)
  host/               legacy ES3 host (fallback, frozen)
scripts/              setup-windows.ps1, install-cep.mjs, smoke.mjs
docs/                 architecture, tools, security, recipes, install
tests/                protocol, paths, docs and tool tests
```

## Credits

- Logo lettering uses **SpacePixi**, designed by Muaj. SpacePixi is used for the logo artwork only; the
  panel UI uses system fonts.
- Panel scaffold: [bolt-cep](https://github.com/hyperbrew/bolt-cep).
- Design principles are inspired by the official [Blender MCP server](https://www.blender.org/lab/mcp-server/).
- After Effects API reference: [ae-scripting.docsforadobe.dev](https://ae-scripting.docsforadobe.dev/).

## License

MIT
