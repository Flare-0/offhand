# Architecture

## Goals

1. An agent should complete common After Effects work without writing ExtendScript.
2. A tool call should return only what the next decision needs.
3. A failed call should tell the agent how to fix it.
4. The host integration must survive CEP being replaced by UXP.
5. The bridge must be local, authenticated, and observable.

Non-goals for v1: headless rendering, multi-user servers, remote access, and a full reimplementation
of the After Effects API.

## Topology

```
┌──────────────┐   stdio    ┌──────────────────────────────┐
│  MCP client  │◄──────────►│  offhand server (Node / TS)  │
└──────────────┘            │  - McpServer                 │
                            │  - tool registry             │
                            │  - WebSocket listener        │
                            │  - usage log                 │
                            └──────────────┬───────────────┘
                                           │ ws://127.0.0.1:<port>
                                           │ token auth
                            ┌──────────────▼───────────────┐
                            │  CEP panel (Chromium)        │
                            │  - reads bridge.json         │
                            │  - reconnects                │
                            │  - serializes evalScript     │
                            └──────────────┬───────────────┘
                                           │ evalScript
                            ┌──────────────▼───────────────┐
                            │  ExtendScript host           │
                            │  - Offhand.dispatch          │
                            │  - typed handlers            │
                            │  - undo groups               │
                            └──────────────┬───────────────┘
                                           │
                                     After Effects
```

The server owns the listener. The panel is a client. This is the opposite of the official Blender
MCP's socket direction, and it is deliberate:

- CEP's embedded Node is old and inconsistent across AE versions.
- The server can start before After Effects and wait.
- The panel can reconnect after a crash or a server restart.
- The host adapter stays small: read a file, open a socket, call `evalScript`.

## Components

### Server (`src/server/`)

- `server.ts` creates the MCP server, registers tools, and connects stdio.
- `bridge.ts` owns the WebSocket server, authentication, request correlation, heartbeats, and
  disconnect handling.
- `tools/` contains one module per tool plus the registry.
- `data/ae-docs.ts` is the bundled reference used by `docs`.
- `log.ts` writes JSONL usage records to `%APPDATA%\offhand\logs\usage.jsonl`.

### Bridge

The bridge writes `%APPDATA%\offhand\bridge.json` after listening:

```json
{
  "version": 1,
  "host": "127.0.0.1",
  "port": 51234,
  "token": "…",
  "pid": 12345,
  "startedAt": "2026-11-24T…"
}
```

The token is stable per user and stored in `%APPDATA%\offhand\token`. The port is random by default;
set `OFFHAND_PORT` to pin it.

Every call has an id and a timeout. A result resolves the matching pending promise. On disconnect,
every pending call rejects with `BRIDGE_DISCONNECTED`; on timeout, with `BRIDGE_TIMEOUT`.

### Panel (`extension/client/`)

The CEP panel:

1. Reads `bridge.json` through `cep.fs`.
2. Opens a WebSocket to `ws://127.0.0.1:<port>`.
3. Sends `hello` with the token, protocol version, panel version, and a snapshot.
4. Handles `call` messages by running `Offhand.dispatch(tool, argsJson)` through `evalScript`.
5. Sends `result` messages back.
6. Reconnects every two seconds after a close.

`evalScript` is serialized through a promise queue. Overlapping calls would otherwise interleave in
the single ExtendScript engine.

### Host (`extension/host/`)

`offhand.jsx` is the entry point. It loads the JSON polyfill, utility functions, and tool modules.
ExtendScript is ES3-era, so the host carries its own JSON implementation.

`Offhand.dispatch`:

- Parses arguments.
- Finds the handler.
- Opens an undo group for write tools.
- Runs the handler.
- Serializes `{ ok: true, data }` or `{ ok: false, error }`.
- Always closes the undo group.

Only `execute` is marked as a write tool today. New mutating tools must be added to
`Offhand.writeTools`.

## Call flow

```
client → server: tools/call { name: "status", arguments: {} }
server → panel:  { type: "call", id, tool: "status", args: {} }
panel → host:    evalScript('Offhand.dispatch("status", "{}")')
host → panel:    {"ok":true,"data":{...}}
panel → server:  { type: "result", id, ok: true, data: {...} }
server → client: content: [{ type: "text", text: "{...}" }]
```

## Tool contract

- Tool names are verbs or noun groups: `status`, `layer`, `render`.
- Descriptions state what the tool does, when to use it, what it returns, and when not to use it.
- Inputs are flat. Prefer ids, names, and paths over opaque handles.
- Read tools default to a small limit and return a truncation footer.
- Write tools are explicit about mutation and run in an undo group.
- Errors use `{ isError: true }` with a readable message, a code, and a hint.
- Unknown tools are protocol errors; business failures are tool execution errors.

## Data locations

| Path | Purpose |
| --- | --- |
| `%APPDATA%\offhand\bridge.json` | Active port, token, pid |
| `%APPDATA%\offhand\token` | Stable per-user bridge token |
| `%APPDATA%\offhand\logs\usage.jsonl` | Tool usage, timing, and execute reasons |
| `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel` | Installed panel |

`OFFHAND_HOME` overrides the offhand data directory.

## Failure modes

| Failure | Behavior |
| --- | --- |
| Server starts before AE | Bridge listens; calls return `BRIDGE_OFFLINE` until the panel connects. |
| Panel opens before server | Panel retries every two seconds. |
| Server restarts | Panel reads the new bridge file and reconnects. |
| AE crashes | Socket closes; pending calls reject; panel retries. |
| Panel token mismatch | Server closes with `AUTH_FAILED`. |
| Call exceeds timeout | `BRIDGE_TIMEOUT`; the operation may still be running in AE. |
| ExtendScript throws | Host returns `{ ok: false, error }`; server surfaces a tool error. |
| Long render | Use a job handle in the render tool, not a longer socket timeout. |

## UXP migration

The panel is the only component that knows about CEP. The host API is a set of plain ExtendScript
functions behind `Offhand.dispatch`. When UXP exposes the required AE APIs:

1. Replace `extension/client` with a UXP panel.
2. Keep the WebSocket protocol and token handshake.
3. Replace `evalScript` with the UXP execution bridge.
4. Keep `extension/host` until the UXP API covers the same surface.

The server and tool contracts do not change.
