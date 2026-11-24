<p align="center">
  <img src="assets/logo.svg" alt="offhand" width="420" />
</p>

<h1 align="center">offhand</h1>

<p align="center"><strong>After Effects, at hand.</strong></p>

<p align="center">
  An MCP server for Adobe After Effects. Typed tools first, ExtendScript only when you ask for it.
</p>

---

## Status

Early build. The local bridge, CEP panel, `status`, `docs`, and the `execute` escape hatch are
implemented. Typed composition, layer, property, effect, text, shape, mask, render, asset, and view
tools are the next phase.

## Why

Most After Effects automation hands the model a blank ExtendScript buffer. That is flexible, but it
is slow, token-hungry, and easy to get wrong. **offhand** takes the opposite approach:

- **Typed tools for the common work.** Inspect the project, find a layer, set a property, add an
  effect, animate a value, render a preview.
- **One escape hatch.** `execute` runs raw ExtendScript, requires a reason, and is logged.
- **Small responses.** Compact JSON, default limits, and truncation footers instead of dumping an
  entire project.
- **Actionable errors.** “No composition named X. Call project with action="comps" to list
  compositions.” Not a JSX stack trace.
- **Real undo.** Write tools run inside one `app.beginUndoGroup("offhand: …")`.
- **Local by default.** The bridge listens on `127.0.0.1` with a per-user token.

## How it works

```
MCP client  ⇐ stdio ⇒  offhand server (Node + TypeScript)
                            ⇐ WebSocket 127.0.0.1 ⇒  CEP panel inside After Effects
                                                         ⇐ evalScript ⇒ ExtendScript host
```

The server owns the WebSocket listener. The CEP panel connects out as a client, reads the port and
token from `%APPDATA%\offhand\bridge.json`, and reconnects automatically. This avoids shipping Node
inside CEP and keeps the host adapter small enough to replace when After Effects moves to UXP.

## Quick start

Requirements: Windows, After Effects 2023 or newer, Node 20 or newer.

```powershell
npm install
npm run build
npm run install:cep
```

Then:

1. Restart After Effects.
2. Open **Window → Extensions → offhand**.
3. Add the MCP server to your client.

Local development config:

```json
{
  "mcp": {
    "offhand": {
      "type": "local",
      "command": ["node", "D:/Projects/offhand/dist/cli.js"],
      "enabled": true
    }
  }
}
```

Published package config:

```json
{
  "mcp": {
    "offhand": {
      "type": "local",
      "command": ["npx", "-y", "offhand-mcp"],
      "enabled": true
    }
  }
}
```

Check the installation:

```powershell
npm run doctor
```

## Tools

| Tool | Status | Purpose |
| --- | --- | --- |
| `status` | Live | Bridge, project, active comp, playhead, selection. |
| `docs` | Live | Search the bundled AE scripting and expression reference. |
| `execute` | Live | Last-resort ExtendScript. Requires a reason. |
| `project` | Next | List, open, save, and inspect project items. |
| `comp` | Next | Create and inspect compositions. |
| `layer` | Next | List, select, create, and update layers. |
| `property` | Next | Get/set values, keyframes, and expressions by path. |
| `effect` | Next | Add, configure, reorder, and remove effects. |
| `text` | Next | Create and edit text layers. |
| `shape` | Next | Create and edit shape layers. |
| `mask` | Next | Create and edit masks. |
| `render` | Next | Preview frames and queue renders. |
| `assets` | Next | Import, relink, and replace footage. |
| `view` | Next | Open comps, set the playhead, and focus the viewer. |

See [docs/tools.md](docs/tools.md) for schemas and examples.

## Security

- The bridge binds to `127.0.0.1` on a random port.
- The panel authenticates with a token stored in `%APPDATA%\offhand\token`.
- `execute` is arbitrary code with the same privileges as After Effects. It is **not** a sandbox.
- Usage is logged to `%APPDATA%\offhand\logs\usage.jsonl`; `execute` calls record their reason.

Read [docs/security.md](docs/security.md) before using `execute` on a project you care about.

## Development

```powershell
npm run dev        # rebuild on change
npm run typecheck
npm test
npm run build
```

Project layout:

```
src/server/        MCP stdio server, WebSocket bridge, tool registry
src/shared/        protocol types, errors, paths
extension/         CEP panel + ExtendScript host
  CSXS/manifest.xml
  client/          panel UI (system fonts)
  host/            ExtendScript host and tools
scripts/           CEP installer
docs/              architecture, tools, security, recipes
assets/            logo and brand assets
tests/             unit and bridge tests
```

## Credits

- Logo lettering uses **SpacePixi**, designed by Muaj. SpacePixi is used for the logo artwork only;
  the panel UI uses system fonts.
- Design principles are inspired by the official [Blender MCP server](https://www.blender.org/lab/mcp-server/).
- After Effects API reference: [ae-scripting.docsforadobe.dev](https://ae-scripting.docsforadobe.dev/).

## License

MIT
