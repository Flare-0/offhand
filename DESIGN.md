# DESIGN.md — offhand

> Architecture, design decisions, and principles for **offhand**.
> This is the living design document. Update it when decisions change.

---

## Goal

An MCP server for Adobe After Effects where an AI agent can do **95% of common work** through typed, high-level tools — no ExtendScript required. The 5% that needs it goes through `execute`, which is explicitly logged.

Design principles (from Blender's official MCP server, adapted for AE):

1. **Typed tools for the common work.** Inspect the project, find a layer, set a property, add an effect, animate a value, render a preview.
2. **One escape hatch.** `execute` runs raw ExtendScript, requires a reason, and is logged.
3. **Small responses.** Compact JSON, default limits, truncation footers instead of dumping entire project state.
4. **Actionable errors.** `"No composition named X. Call project with action='comps' to list compositions."` — not a JSX stack trace.
5. **Real undo.** Write tools run inside one `app.beginUndoGroup("offhand: …")`.
6. **Local by default.** The bridge listens on `127.0.0.1` with a per-user token.

---

## System topology

```
MCP client  ⟵ stdio ⟶  offhand server (Node / TypeScript)
                             ⟵ WebSocket 127.0.0.1:<random port> ⟶  CEP panel inside After Effects
                                                                        ⟵ evalScript ⟶ ExtendScript host
```

**Key design choice: the Node server owns the WebSocket listener; the CEP panel connects out.**

This is the inverse of Blender MCP (Blender addon runs the server). Reasons:

- CEP's embedded Node is old (varies by AE version); running a WS server in it is unreliable.
- The offhand Node server can start before AE opens and simply wait.
- When the panel crashes or AE restarts, the panel reconnects — the server keeps running.
- The host adapter (JSX side) is small enough to be replaced when AE moves to UXP.

---

## Components

### Server (`src/server/`)

| File | Responsibility |
|---|---|
| `server.ts` | Creates `McpServer`, iterates `TOOLS`, registers each via `server.registerTool()`, connects `StdioServerTransport`, graceful shutdown. |
| `bridge.ts` | Owns the `WebSocketServer`. Auth handshake, request correlation map (`pending`), heartbeat, hardened reconnect (replaces stale socket). |
| `tools/registry.ts` | `TOOLS: ToolDefinition[]` — single source of truth for all registered tools. |
| `tools/types.ts` | `ToolDefinition`, `ToolContext`, `ToolTextResult` interfaces. |
| `tools/result.ts` | `textResult()`, `errorResult()`, `capText()`. |
| `data/ae-docs.ts` | Bundled AE scripting + expressions reference entries (`DocEntry[]`). |
| `log.ts` | JSONL append-only usage log at `%APPDATA%\offhand\logs\usage.jsonl`. Never stdout. |
| `doctor.ts` | `doctor()` report for `offhand doctor` command. |

### Shared (`src/shared/`)

| File | Responsibility |
|---|---|
| `protocol.ts` | All WebSocket message types: `HelloMessage`, `WelcomeMessage`, `CallMessage`, `ResultMessage`, `PingMessage`, `PongMessage`, `BridgeEventMessage`, `AuthErrorMessage`. Plus `AeSnapshot`, `BridgeStatus`. |
| `errors.ts` | `OffhandError`, `OffhandErrorCode`, `serializeError()`, `toOffhandError()`. |
| `paths.ts` | `appDataDir()`, token file, bridge config file (read/write/remove), log path. |
| `version.ts` | `VERSION`, `SERVER_NAME`, `PROTOCOL_VERSION`. |

### CLI (`src/cli.ts`)

Entry point. Commands: (default) start server, `doctor`, `install`, `--version`, `--help`.

### Extension (`extension/`)

```
extension/
  CSXS/manifest.xml          CEP manifest (ExtensionBundleId: com.offhand.panel, AE 2023+)
  client/
    index.html               Panel HTML
    panel.js                 Panel JS: reads bridge.json, connects WebSocket, serializes evalScript calls
    styles.css               System font stack, dark palette UI
  host/
    offhand.jsx              Entry point: Offhand.dispatch(), Offhand.include(), load guard
    core/
      json.jsx               ES3 JSON polyfill (parse/stringify)
      util.jsx               Offhand.util: fail(), project(), findComp(), findLayer(), time(), color()
    tools/
      status.jsx             AE snapshot tool handler
      execute.jsx            Raw ExtendScript handler
      comp.jsx               (stub → implement)
      layer.jsx              (stub → implement)
      project.jsx            (stub → implement)
      property.jsx           (to create)
      effect.jsx             (to create)
      text.jsx               (to create)
      shape.jsx              (to create)
      mask.jsx               (to create)
      render.jsx             (to create)
      assets.jsx             (to create)
      view.jsx               (to create)
```

---

## Bridge protocol

All messages are JSON over WebSocket (`ws://127.0.0.1:<port>`).

### Handshake

```
Panel → Server:  { type: "hello", protocol: 1, token: "...", panelVersion: "0.1.0", ae: AeSnapshot }
Server → Panel:  { type: "welcome", protocol: 1, serverVersion: "0.1.0" }
```

If token is wrong or protocol mismatch:
```
Server → Panel:  { type: "error", code: "AUTH_FAILED"|"PROTOCOL_MISMATCH", message: "..." }
                 then close(4003)
```

### Tool call

```
Server → Panel:  { type: "call", id: "<uuid>", tool: "status", args: {}, timeoutMs: 30000 }
Panel → Server:  { type: "result", id: "<uuid>", ok: true, data: {...}, ms: 42 }
                 or
Panel → Server:  { type: "result", id: "<uuid>", ok: false, error: { code, message, hint? }, ms: 42 }
```

### Heartbeat

```
Server → Panel:  { type: "ping", ts: 1234567890 }
Panel → Server:  { type: "pong", ts: 1234567890 }
```

Heartbeat every 15 seconds. If no pong for 45+ seconds, server terminates the stale socket.

### Bridge config file

Written atomically to `%APPDATA%\offhand\bridge.json` on server start:
```json
{ "version": 1, "host": "127.0.0.1", "port": 52345, "token": "<48 hex chars>", "pid": 12345, "startedAt": "..." }
```

Removed on clean shutdown. The panel reads this at startup and on reconnect.

---

## Security model

- Bridge binds exclusively to `127.0.0.1`.
- Token is 24 random bytes (hex) stored in `%APPDATA%\offhand\token` with mode `0o600` (best-effort on Windows).
- `Bridge.handleConnection` rejects origins that are not `file://`, `null`, `chrome-extension://`, or localhost HTTP.
- `execute` is arbitrary code with After Effects privileges. It is **not sandboxed**. The `reason` field is required and logged.
- Usage log is at `%APPDATA%\offhand\logs\usage.jsonl` — append only, never overwritten.

---

## Tool design rules

These rules come from both the Blender MCP design and Anthropic's "Writing effective tools for agents" (Sep 2025).

### Naming and selection
- Tool names are short and intent-based: `project`, `comp`, `layer`, `property`, `effect`, `text`, `shape`, `mask`, `render`, `assets`, `view`.
- Each tool has a primary `action` parameter (`enum`) rather than separate tools for each CRUD operation.
- Tool descriptions are 1–3 sentences: **what it does + when to use it + when not to use it**.

### Inputs
- `comp` accepts name (string) or numeric id; falls back to active comp if omitted.
- `layer` accepts name (string) or index (number); falls back to selected layer if omitted.
- Times are seconds (floats). Explicit field names like `time`, `inPoint`, `outPoint`.
- Colors accept `"#rrggbb"` or `[r, g, b]` in 0–1 or 0–255 (auto-detected by `Offhand.util.color()`).
- Read tools have a `limit` parameter (default 25–50, max 100).

### Outputs
- Compact JSON — no internal AE UUIDs, raw `created_at`, null fields, or verbose metadata.
- Prefer human-readable names: `name`, `type`, `color` over internal match names.
- Lists include a `count` and optionally a `hint` when truncated.
- Errors: `isError: true`, content `[CODE] message\nHint: next step`.

### Error messages
Every `OffhandError` has:
- `code` — from `OffhandErrorCode` union (`NOT_FOUND`, `INVALID_ARGS`, `BRIDGE_OFFLINE`, etc.)
- `message` — specific: what failed and what value was given
- `hint` — what to call next or how to fix it

Example pattern:
```ts
throw new OffhandError('NOT_FOUND', `No composition named "${name}".`, {
  hint: 'Call project with action="comps" to list compositions.',
});
```

### Write tools and undo
All write tools are listed in `Offhand.writeTools` in `offhand.jsx`. The dispatcher wraps them in `app.beginUndoGroup("offhand: <tool>")` / `app.endUndoGroup()` automatically — tool handlers do NOT call these themselves.

### Destructive actions
Tools with `delete`, `replace`, or `queue` actions that cannot be undone (or are hard to undo) should require a `confirm: true` parameter, documented explicitly.

---

## Host-side (ExtendScript) rules

The host runs in ExtendScript (Adobe's ES3-based engine). Strict constraints:

- **No `const`/`let`** — use `var`
- **No arrow functions** — use `function(x) { ... }`
- **No template literals** — use string concatenation
- **No destructuring** — `var x = obj.x`
- **No `Array.forEach` with arrow** — use `for` loops
- **No `JSON`** — use `Offhand.json.parse()` and `Offhand.json.stringify()`
- **No `try { ... } catch(e) { ... }` with block-scoped vars** — declare vars before try

`Offhand.util` provides the shared helpers:
- `Offhand.util.fail(code, message, hint?)` — throws an error that `Offhand.dispatch` catches and serializes
- `Offhand.util.project()` — returns `app.project` or throws `INVALID_STATE`
- `Offhand.util.comp(selector)` — finds comp by id/name/active, throws `NOT_FOUND`
- `Offhand.util.layer(comp, selector)` — finds layer by index/name/selected
- `Offhand.util.time(args, comp?)` — extracts `args.time` or falls back to current comp time
- `Offhand.util.color(value)` — normalizes `"#rrggbb"` / `[r,g,b]` to `[0-1, 0-1, 0-1]`

---

## Panel (CEP client) design

`extension/client/panel.js`:

1. On load, reads `%APPDATA%/offhand/bridge.json` using `cep.fs.readFile`.
2. Connects to `ws://127.0.0.1:<port>`.
3. Sends `hello` with token from bridge.json.
4. On `call` message: calls `evalScript('Offhand.dispatch("' + tool + '", ' + JSON.stringify(argsJson) + ')')`.
5. `evalScript` callback is async (non-blocking for CEP's event loop). Calls are serialized via a queue (one at a time).
6. Sends `result` with the parsed host response.
7. Reconnects on close (2 second backoff, re-reads bridge.json).
8. Responds to server `ping` with `pong`.

**Important:** The host script (`extension/host/offhand.jsx`) is loaded via `$.evalFile` on first dispatch (guarded by `Offhand.loaded`). The `ScriptPath` in `manifest.xml` also references it for auto-load, but the panel re-evals it to be safe.

---

## Build and release

```powershell
npm run build      # tsup → dist/cli.js (ESM, Node 20+, shebang)
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run lint       # eslint
```

The `tsup.config.ts` bundles `src/cli.ts` → `dist/cli.js` with a `#!/usr/bin/env node` banner.

For npm publish:
```powershell
npm publish --access public
```

The `files` field in `package.json` includes: `dist`, `extension`, `scripts`, `assets`, `docs`, `README.md`, `LICENSE`.

---

## Planned tool schemas (from `docs/tools.md`)

Reproduced here for quick reference. These are the exact shapes to implement.

### `project`
```json
{ "action": "info" }
{ "action": "comps", "limit": 50 }
{ "action": "items", "kind": "footage", "limit": 50 }
{ "action": "open", "path": "C:/work/project.aep" }
{ "action": "save" }
```

### `comp`
```json
{ "action": "list", "limit": 25 }
{ "action": "get", "comp": "Main" }
{ "action": "create", "name": "Lower Third", "width": 1920, "height": 1080, "fps": 30, "duration": 8 }
{ "action": "set", "comp": "Main", "width": 1080, "height": 1920 }
```

### `layer`
```json
{ "action": "list", "comp": "Main", "limit": 50 }
{ "action": "get", "comp": "Main", "layer": "Title" }
{ "action": "create", "comp": "Main", "type": "text", "name": "Title" }
{ "action": "create", "comp": "Main", "type": "solid", "name": "BG", "color": "#0f000d", "width": 1920, "height": 1080 }
{ "action": "set", "comp": "Main", "layer": "Title", "inPoint": 0, "outPoint": 5 }
{ "action": "delete", "comp": "Main", "layer": "Title", "confirm": true }
```

### `property`
```json
{ "action": "get", "comp": "Main", "layer": "Title", "path": "transform.position" }
{ "action": "set", "comp": "Main", "layer": "Title", "path": "transform.position", "value": [960, 540] }
{ "action": "keyframe", "comp": "Main", "layer": "Title", "path": "transform.opacity", "time": 0, "value": 0 }
{ "action": "expression", "comp": "Main", "layer": "Title", "path": "transform.position", "expression": "wiggle(2, 30)" }
```

### `effect`
```json
{ "action": "list", "comp": "Main", "layer": "Title" }
{ "action": "search", "query": "glow" }
{ "action": "add", "comp": "Main", "layer": "Title", "effect": "ADBE Glo2" }
{ "action": "set", "comp": "Main", "layer": "Title", "effect": "Glow", "property": "Glow Threshold", "value": 0.5 }
{ "action": "remove", "comp": "Main", "layer": "Title", "effect": "Glow", "confirm": true }
```

### `text`
```json
{ "action": "create", "comp": "Main", "text": "After Effects, at hand.", "font": "Arial-BoldMT", "size": 96, "color": "#fedefe", "position": [960, 540] }
{ "action": "get", "comp": "Main", "layer": "Title" }
{ "action": "set", "comp": "Main", "layer": "Title", "text": "New copy" }
```

### `shape`
```json
{ "action": "create", "comp": "Main", "shape": "rect", "size": [640, 360], "color": "#fa3571", "position": [960, 540] }
{ "action": "create", "comp": "Main", "shape": "ellipse", "size": [200, 200], "color": "#ffbbfb" }
{ "action": "set", "comp": "Main", "layer": "Shape 1", "size": [800, 400] }
```

### `mask`
```json
{ "action": "list", "comp": "Main", "layer": "Footage" }
{ "action": "create", "comp": "Main", "layer": "Footage", "shape": "rect", "bounds": [240, 135, 1440, 810] }
{ "action": "set", "comp": "Main", "layer": "Footage", "mask": "Mask 1", "mode": "add", "feather": 12 }
```

### `render`
```json
{ "action": "frame", "comp": "Main", "time": 2.0, "path": "C:/work/preview.png" }
{ "action": "queue", "comp": "Main", "output": "C:/work/render.mov", "template": "Best Settings" }
{ "action": "status" }
```

### `assets`
```json
{ "action": "import", "paths": ["C:/work/clip.mp4"] }
{ "action": "list", "limit": 50 }
{ "action": "replace", "item": "clip.mp4", "path": "C:/work/clip_v2.mp4" }
```

### `view`
```json
{ "action": "open", "comp": "Main" }
{ "action": "time", "comp": "Main", "time": 3.5 }
{ "action": "select", "comp": "Main", "layer": "Title" }
```

---

## Brand and palette

Logo uses **SpacePixi** pixel font (designed by Muaj, outlines only — TTF not committed).

| Token | Hex |
|---|---|
| `--text` | `#fedefe` |
| `--background` | `#0f000d` |
| `--primary` | `#ffbbfb` |
| `--secondary` | `#bc004c` |
| `--accent` | `#fa3571` |

UI uses **system fonts only** (`"Segoe UI", system-ui, -apple-system, sans-serif`). SpacePixi is logo-only.
