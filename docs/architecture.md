# Architecture

## Goals

1. An agent should complete common After Effects work without writing ExtendScript.
2. A tool call should return only what the next decision needs.
3. A failed call should tell the agent how to fix it.
4. The host integration must survive CEP being replaced by UXP.
5. The bridge must be local, authenticated, and observable.

Non-goals for v1: headless rendering (no AE UI), multi-user servers, remote access, and a full
reimplementation of the After Effects API.

## Topology

```
┌──────────────┐   stdio    ┌──────────────────────────────┐
│  MCP client  │◄──────────►│  offhand server (Node / TS)  │
└──────────────┘            │  - McpServer                 │
                            │  - tool registry             │
                            │  - WebSocket *client*        │
                            │  - reads bridge.json         │
                            └──────────────┬───────────────┘
                                           │ ws://127.0.0.1:<port>
                                           │ hello / token
                            ┌──────────────▼───────────────┐
                            │  CEP panel (Chromium + Node) │
                            │  - WebSocket *server*        │
                            │  - writes bridge.json        │
                            │  - serializes host calls     │
                            │  - settings + audit log      │
                            └──────────────┬───────────────┘
                                           │ evalScript (evalTS)
                            ┌──────────────▼───────────────┐
                            │  ExtendScript host (ES3)     │
                            │  - host.ts dispatcher        │
                            │  - 14 typed handlers         │
                            │  - one undo group per write  │
                            └──────────────┬───────────────┘
                                           │
                                     After Effects
```

**The panel owns the listener; the MCP server dials in.** This is the reverse of the pre-rewrite design,
and it is deliberate:

- The panel is long-lived and lives inside AE, so it *is* the stable endpoint. The MCP server is
  short-lived (one process per agent session) and can come and go freely.
- Several MCP clients can connect to the same After Effects at once.
- There is no port to configure and no port conflict: if 47823 is taken the panel falls back to an
  ephemeral port and publishes it.
- Discovery no longer uses `cep.fs` — the panel writes `bridge.json` with real Node `fs`. The original
  silent failure (“Waiting for server”, caused by `cep.fs` returning `null`) cannot recur.
- The server starts fine with After Effects closed: it retries in the background and tools return a
  diagnosis instead of a hang.

## Components

### Server (`src/`)

- `cli.ts` — entry point (`offhand-mcp`), `doctor` subcommand, `OFFHAND_HOME` override.
- `server/server.ts` — creates the MCP server, registers the 14 tools, starts the bridge, wires shutdown.
  Never writes to stdout (stdio transport).
- `server/bridge.ts` — **dial-in client**: watches `bridge.json`, connects, sends `hello`, awaits
  `welcome`, heartbeats, correlates `call`/`result` by id, enforces deadlines, maps failures to diagnosis
  codes, retries with exponential backoff. `start()` is non-blocking.
- `server/tools/` — one module per tool plus `registry.ts`, `result.ts`, `types.ts`.
- `server/data/ae-docs.ts` — bundled AE scripting/expression reference used by `docs`.
- `server/log.ts` — JSONL audit log (`usage.jsonl`, `execute` reasons).
- `server/doctor.ts` — hop-by-hop installation check.
- `shared/protocol.ts` — protocol v2 types shared by the server (the panel has a deliberate copy).
- `shared/paths.ts` — `bridge.json`, token, log paths; atomic writes with Windows retry.
- `shared/errors.ts` — error taxonomy and formatting.

### Bridge protocol (v2)

The panel publishes `%APPDATA%\offhand\bridge.json`:

```json
{
  "version": 2,
  "protocol": 2,
  "host": "127.0.0.1",
  "port": 47823,
  "token": "…48 hex…",
  "pid": 12345,
  "panelVersion": "0.3.0",
  "startedAt": 1795619716990
}
```

The token is stable per user (`%APPDATA%\offhand\token`, created with `wx` so two processes cannot
race). `bridge.json` is written with a temp file + rename, retrying `EPERM`/`EBUSY`/`EACCES` — on Windows
an antivirus or AE itself can hold the file briefly.

Handshake:

1. server → panel `hello { protocol, token, clientVersion }`
2. panel → server `welcome { protocol, panelVersion, ae, settings }` or `error { code, message, hint }`
3. panel pings every 15 s; 45 s without a pong closes the socket.

Every `call` carries `id`, `timeoutMs` and an absolute `deadline`. The server always resolves — with
`result`, `error` or a timeout — so a stuck AE becomes `AE_BUSY` (“a dialog may be open”) rather than an
MCP client timeout.

Read failures are classified instead of collapsed:

```ts
readBridgeConfigFile() →
  | { status: 'ok'; config }
  | { status: 'missing' }          // PANEL_NOT_RUNNING
  | { status: 'legacy'; version }  // VERSION_MISMATCH
  | { status: 'malformed'; error } // BRIDGE_STALE + reason
```

### Panel (`extension/src/js/`)

bolt-cep project (React + Vite + TypeScript). Built to `extension/dist/cep/`, which *is* the CEP
extension root.

- `main/main.tsx` — bridge chip (`idle | listening | ready | degraded`), endpoint, client count, AE
  snapshot, activity log, Reconnect, Copy MCP config, Permissions toggle.
- `bridge/server.ts` — `PanelBridge`: binds the WS server (preferred port 47823, falls back to 0), auth
  timeout (5 s), hello validation, welcome with a cached AE snapshot, 15 s ping / 45 s pong deadline,
  **one serialized host-call queue** with per-call deadlines, `restart()`, status subscriptions.
- `bridge/config.ts` — `bridge.json` and token writer; `OFFHAND_HOME` aware.
- `bridge/settings.ts` — `settings.json` (`allowRawScripts`).
- `bridge/host.ts` — the `evalTS('dispatch', tool, argsJson)` boundary; maps host payloads to typed
  errors.
- `bridge/types.ts` — protocol copy. The panel is a separate TypeScript root without access to
  `src/shared`; this duplication is intentional and small.

Raw scripts are gated here, in the panel, not in the MCP server: while disabled, an `execute` call is
answered with `EXECUTE_DISABLED` and never reaches ExtendScript. No MCP tool can flip the setting; it is a
human decision in the UI.

### Host (`extension/src/jsx/`)

TypeScript, compiled to **ES3** by bolt-cep's Babel pipeline (`vite.es.config.ts`).

- `index.ts` — assigns the namespace (`host[ns] = aeft`) and exports the `Scripts` type the panel
  type-checks against.
- `host.ts` — dispatcher: parse args, look up the handler in `core/state.ts`, open an undo group for
  write tools, run, serialize `{ ok: true, data }` / `{ ok: false, error }`, always close the undo group.
- `core/state.ts` — shared namespace (`tools`, `writeTools`, `json`, `util`) filled by side-effect imports.
- `core/json.ts` — ExtendScript’s `JSON` is unreliable/absent; this is the host’s own implementation.
- `core/util.ts` — argument validation, property aliases (`transform.position` →
  `ADBE Transform Group/ADBE Position`), comp/layer/property resolution, rounding.
- `tools/*.ts` — 14 handlers, one per MCP tool.
- `aeft/aeft.ts` — the `dispatch` entry bolt-cep exposes; falls back to the legacy bundle only if the
  ported dispatcher lacks a handler.

`extension/host/` is the frozen pre-rewrite ES3 tree. It is still copied into `dist/cep/host` so the
fallback works, and it must not be edited.

## Call flow

```
client → server: tools/call { name: "layer", arguments: {...} }
server → panel:  { type: "call", id, tool: "layer", args, timeoutMs, deadline }
panel:            queue → evalTS("dispatch", "layer", "<json>")
host:             Offhand.tools.layer(args) inside one undo group
host → panel:     {"ok":true,"data":{...}}
panel → server:   { type: "result", id, ok: true, data, ms }
server → client:  content: [{ type: "text", text: "{...}" }]
```

## Tool contract

- Tool names are verbs or noun groups: `status`, `layer`, `render`.
- Descriptions state what the tool does, when to use it, what it returns, and when not to use it.
- Inputs are flat. Prefer names and paths over opaque handles.
- Read tools default to a small limit and return a truncation footer.
- Write tools are explicit about mutation and run in an undo group.
- Errors use `{ isError: true }` with a readable message, an error code, and a hint.
- Unknown tools are protocol errors; business failures are tool execution errors.

## Data locations

| Path | Purpose |
| --- | --- |
| `%APPDATA%\offhand\bridge.json` | Published port, token, pid, panel version, protocol (v2) |
| `%APPDATA%\offhand\token` | Stable per-user bridge token |
| `%APPDATA%\offhand\settings.json` | Panel settings (`allowRawScripts`) |
| `%APPDATA%\offhand\logs\usage.jsonl` | Tool usage, timing, and `execute` reasons |
| `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel` | Installed panel |

`OFFHAND_HOME` overrides the offhand data directory (tests use it to get a clean sandbox).

## Failure modes

| Failure | Behavior |
| --- | --- |
| Server starts before AE | Non-blocking start; tools return `PANEL_NOT_RUNNING` until the panel exists. |
| AE starts after server | Server notices the new `bridge.json` within ~400 ms and connects. |
| Panel restarts | New pid/port/`startedAt` → backoff resets, server reconnects. |
| `bridge.json` from an old session | `BRIDGE_STALE` with a reconnect hint. |
| Token mismatch | Panel closes 4003; server reports `TOKEN_MISMATCH`. |
| Protocol mismatch | Panel closes 4004; server reports `VERSION_MISMATCH`. |
| Modal AE dialog | Call deadline fires; server reports `AE_BUSY` and releases the queue. |
| Host throws | Host returns `{ ok: false, error }`; server surfaces code + hint. |
| Long render | Use the render job pattern (Phase E) instead of a longer timeout. |

## UXP migration

The panel is the only CEP-aware component, and the host API is plain ExtendScript behind
`Offhand.dispatch`. When UXP exposes the required AE APIs:

1. Replace the bolt-cep panel with a UXP panel.
2. Keep the WebSocket protocol, token handshake and `bridge.json` discovery.
3. Replace `evalScript`/`evalTS` with the UXP execution bridge.
4. Keep the host semantics (one undo group per write, JSON payloads) until UXP covers the surface.

The server and the tool contracts do not change.
