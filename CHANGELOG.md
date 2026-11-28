# Changelog

All notable changes to offhand. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions use [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-11-28

Layers are identified by a stable uid, and renders no longer hold the bridge call open.

### Changed

- **Breaking: layer uids replace indexes and numeric layer ids.** Every layer row carries `uid: "L<id>"`
  (and `parentUid`), and `layer` selectors accept a uid or name. `"L42"`, `"#42"`, `"id:42"`, `"uid:42"`
  and a bare number all address the same uid; a numeric string is never a position. Layer indexes are
  rejected because reordering silently changes them.
- **`layer reorder` takes `before` or `after`** instead of a target index, and reports the new neighbor
  uids. Duplicate and delete results report uids too.
- **`render start` and `queue { start: true }` schedule rendering** through `app.scheduleTask` and return
  immediately with `scheduled`/`blocking` fields. `render jobs` polls the queue; queue items (including
  finished ones) are adopted after a panel reload, so history is not lost when the panel restarts.
- **Render polling no longer waits behind After Effects.** The scheduled script writes a temp status
  marker; while it says `rendering`, the MCP server answers `jobs`/`status` from the last known state
  without a bridge call. A finished or missing marker resumes live queue polling.
- The scheduled render runs inside `app.beginSuppressDialogs()` so a completion or error alert cannot
  block the ExtendScript engine.
- `render clear` refuses while a render is active and marks both queued and rendering jobs failed when it
  does run.
- Tool results can no longer emit `text: undefined` when a handler returns nothing.

### Removed

- Phase H (npm publish) is no longer planned; the MCP config uses the local `dist/cli.js` build.

### Tests

- 11 files / 100 tests, including uid selectors, reorder by neighbor, parent uids, render scheduling,
  render-queue adoption after a reload, cached polling during a render, clear-while-rendering, property
  expressions/keyframe removal, project save/open, and assets removal.

## [0.2.0] — 2026-11-28

Phase E — the tool surface got agent-shaped: stable ids, honest diffs, batching, cheap reads, and a way
to find out which raw scripts deserve a typed tool.

### Added

- **Stable layer ids.** `layer.id` is returned everywhere a layer is described, and any `layer` selector
  accepts `"#42"` or `"id:42"`. Ids survive renames and reordering; names and indexes still work.
- **Write diffs.** Every write tool returns a `changed` map: `{ "position": { "from": [...], "to": [...] } }`.
  Creators return `created: { id, name, … }`; removals return `removed`. If nothing moved you get a
  `note` instead of silence.
- **`batch` tool** (15 total) — up to 20 typed calls in one round trip, sequential, one undo group,
  `stopOnError` on by default, no nesting. An `execute` inside a batch is blocked by the same panel gate
  that blocks a direct `execute`, so batching cannot be used to sneak around it.
- **`detail: "min" | "full"`** on `layer`, `comp`, `project` and `property`. Default is `min`: ids and the
  fields you need to decide. `full` is the old verbose shape.
- **Render jobs.** `render` gained `queue` (records job `j1`, `j2`, …), `start`, and `jobs`. Jobs carry
  `status`, timing and errors; `start` is still synchronous because ExtendScript cannot render in the
  background.
- **`offhand patterns`** — reads `usage.jsonl`, groups repeated `execute` calls by reason, counts their
  error codes and suggests which typed tool should absorb each one. Documented in
  [docs/tools.md](docs/tools.md#promotion-turning-execute-into-a-typed-tool).
- **Tests:** 10 files / 84 tests, including a mock After Effects host that runs every typed tool
  end to end.

### Changed

- **Renders default to MP4/H.264.** When a queued output ends in `.mp4` and no `outputModule` is
  passed, the host applies the installed H.264 output-module template automatically. Other formats
  still work when asked for explicitly.
- `project items`, `project comps`, `comp list`, `layer list` and `property list` default to compact
  briefs. Ask for `detail: "full"` when you need every field.
- The tool-handler test now verifies `extension/src/jsx/tools/<name>.ts` (the TypeScript host) instead of
  the frozen legacy `.jsx` tree.
- Versions bumped to 0.2.0 across the server, the panel and the host.

### Fixed

- Text layers no longer crash when a fill or stroke color is not applied; each color is read
  defensively.
- 2D/3D vector properties (`PropertyValueType.TwoD`/`ThreeD`) read as arrays instead of
  `"300,200"`-style strings, fixing shape size, mask feather and similar values.
- Vector-size properties that report no enum type in some AE builds (ellipse/rect `Size`, layer
  `Scale`) also read as numeric arrays instead of strings.
- `text set` assigns the `ParagraphJustification` enum constant, so `justification` no longer
  fails with "The enum is of the incorrect type" on newer builds.
- `text set` no longer offers `fauxBold`, `fauxItalic`, or `allCaps`: AE exposes them read-only.
  Passing them now returns a clear `INVALID_ARGS` hint instead of a raw host error.
- `text set` no longer reports "No values changed." when only non-text fields (justification,
  colors, tracking, and so on) changed.
- `property set` verifies the write by reading the property back. A silent no-op now fails with
  `INVALID_STATE` and a hint instead of reporting success.
- `assets import` accepts `path` or `paths`, a single string or an array, including JSON-encoded
  arrays, and never passes `undefined` into the file resolver.
- Render-queue labels come from AE's runtime `RQItemStatus` constants instead of a hardcoded table,
  so `QUEUED`, `NEEDS_OUTPUT`, `DONE` and friends match the installed AE version.
- Render job bookkeeping clears stale `finishedAt`, `ms` and `error` fields between runs.
- `comp get` returns the compact brief by default.
- Shape read-back now includes `id`, `created` and `changed`.

### Known limitations

- `render start` blocks the panel until After Effects finishes; there is no progress stream yet.
- `batch` is all-or-nothing only up to the failing call — earlier calls stay applied inside the undo group.
- The mock host cannot reproduce every After Effects quirk; API edge cases still need a live check.

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
