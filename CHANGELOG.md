# Changelog

All notable changes to offhand. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions use [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-25

First public preview. End-to-end: MCP client → stdio server → local WebSocket → CEP panel → ExtendScript.

### Added

- **14 MCP tools** — `status`, `docs`, `project`, `comp`, `layer`, `property`, `effect`, `text`, `shape`,
  `mask`, `render`, `assets`, `view`, `execute`. Each write runs inside one After Effects undo group.
- **Panel-hosted bridge.** The CEP panel listens on `127.0.0.1` (port 47823, ephemeral fallback) and
  publishes `%APPDATA%\offhand\bridge.json` with port, token, pid, panel version and protocol. Several MCP
  clients can share one After Effects instance.
- **Protocol v2** with a state machine (`idle → connecting → handshaking → ready → degraded`), per-call
  deadlines, heartbeats, and a serialized host-call queue so concurrent tool calls cannot interleave inside
  ExtendScript.
- **Diagnosis codes** instead of `connected: false`: `PANEL_NOT_RUNNING`, `BRIDGE_STALE`, `TOKEN_MISMATCH`,
  `VERSION_MISMATCH`, `AE_BUSY`, each with a hint.
- **`offhand doctor`** — checks version, `bridge.json`, token, extension install, and the live handshake.
- **Panel UI** — bridge state, endpoint, connected clients, live AE project/comp snapshot, activity log,
  working **Reconnect**, one-click **Copy MCP config**, and a **Permissions** section.
- **Raw-script gate.** `execute` is disabled by default and refused in the panel (`EXECUTE_DISABLED`)
  before it can reach ExtendScript. Toggle it in the panel; no MCP tool can enable it remotely.
- **Windows one-liner installer** (`scripts/setup-windows.ps1`): installs Node prerequisites check, builds
  the server and panel, installs the CEP extension, and sets `PlayerDebugMode = 1` for CSXS 9–13.
- **Bundled AE reference** (`docs` tool) for scripting and expressions, so agents can look up API details
  without network access.
- **Tests** — 5 files / 24 tests, including a fake panel that exercises the real protocol (auth, retry,
  reconnect, busy timeouts, settings propagation) and a paths test suite.

### Changed

- The CEP panel was rebuilt from scratch on [bolt-cep](https://github.com/hyperbrew/bolt-cep)
  (React + Vite + TypeScript); the legacy panel and ES3 host remain in `extension/` only as a frozen
  fallback.
- The ExtendScript host is now TypeScript in `extension/src/jsx/`, compiled to ES3 by bolt-cep. The
  previous hand-written `.jsx` handlers are still shipped as a fallback during verification.
- Who owns the socket flipped: the panel hosts it, the MCP server dials in. This removed `cep.fs` from the
  discovery path, which was the cause of silent “Waiting for server” failures.
- Target lowered to **After Effects 2023+** (`AEFT [23.0,99.9]`), verified on 23.6.
- `bridge.json` is versioned (v2); v1 files are rejected explicitly rather than misread.

### Verified

- Panel loads and the bridge reaches `ready` in After Effects 2023 (23.6x62).
- Live calls through the full chain: `status`, `project`, `comp`. Other tools share the same path.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm run build:extension` all pass;
  CI is green.

### Known limitations

- Not every tool has been individually smoke-tested against AE 2023 yet.
- Layers are addressed by name/index; stable layer IDs and write diffs arrive in Phase E, along with
  `batch`, `detail: min|full` and render jobs.
- Windows only. macOS needs the CEP debug defaults written by hand and is untested.
- Not published to npm; use the built `dist/cli.js`.
