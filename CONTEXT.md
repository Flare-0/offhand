# CONTEXT.md — working context for offhand

> Snapshot of the project's state, decisions and next steps, written at each context compaction so a
> fresh agent session can pick up without re-deriving anything. Sanitized: no tokens, no secrets, no
> machine-specific absolute paths.
>
> Last updated: 2026-11-28 (`1.0.0` released; panel redesigned, Phase E live-verified).

---

## 1. What this is

**offhand** (`offhand-mcp`) is an MCP server for Adobe After Effects. It exposes 15 typed tools so an
agent can do common AE work without writing ExtendScript, plus one gated `execute` escape hatch.

Pipeline:

```
MCP client  ⇐ stdio ⇒  offhand server (Node + TypeScript)
                            ⇐ WebSocket 127.0.0.1 ⇒  CEP panel inside After Effects
                                                          ⇐ evalScript ⇒ ExtendScript host (ES3)
```

Repo: <https://github.com/Flare-0/offhand> (public, MIT). Not published to npm — the built `dist/cli.js`
is the entry point.

---

## 2. Standing rules (non-negotiable)

1. **Host ExtendScript must stay ES3** — no arrow functions, `const`/`let`, template literals, destructuring,
   or native `JSON` (use `Offhand.json`).
2. **Never write to stdout in the MCP server** — stdout is the stdio transport; log to stderr / JSONL.
3. **Write tools run inside one undo group** (`app.beginUndoGroup("offhand: …")`), handled by the dispatcher
   for tools listed in `Offhand.writeTools`.
4. **Errors are `[CODE] message` + `Hint:`** with a concrete next step.
5. **No delete commands** (`rm`, `rmdir`, `del`, `Remove-Item`, recursive deletes) on the user's behalf —
   ask first. Copy over, never delete.
6. **Commit + push after every phase**, and update `ROADMAP.md` + `AGENT.md` in the same commit. Sessions
   can die mid-work; an uncommitted phase is a lost phase.
7. **Keep `npm test`, `npm run typecheck`, `npm run lint` green** at every commit.
8. Do **not** delete the legacy `extension/client` + `extension/host` trees until the ported equivalent is
   live-verified and the user consents.
9. **Fonts:** panel UI uses system fonts. **SpacePixi** is used only in the logo artwork; never commit the TTF.
10. **Every compaction** writes/refreshes this file (`CONTEXT.md`), sanitized, and commits it.

Target: **After Effects 2023+** (`AEFT [23.0,99.9]`). Windows only in practice; macOS untested.

---

## 3. Architecture decisions (and why)

- **The CEP panel owns the WebSocket server; the MCP server dials in.** Reversed from the original design
  during the bolt-cep rewrite. The old design made the *server* listen and the panel read `bridge.json`
  through `cep.fs`, which silently returned `null` and produced an undebuggable "Waiting for server".
  Now the panel writes `bridge.json` with real Node `fs` and hosts the socket. Benefits: the long-lived
  component is the stable endpoint, several MCP clients can share one AE instance, and port conflicts
  vanish (prefers 47823, falls back to an ephemeral port and publishes it).
- **State machine, not booleans:** `idle → listening/connecting → handshaking → ready → degraded`, with
  diagnosis codes `PANEL_NOT_RUNNING`, `BRIDGE_STALE`, `TOKEN_MISMATCH`, `VERSION_MISMATCH`, `AE_BUSY`.
- **Protocol v2**, and `bridge.json` is versioned (v2). v1 files are rejected as `VERSION_MISMATCH` rather
  than misread.
- **`execute` is gated in the panel** (`EXECUTE_DISABLED`), off by default. No MCP tool can enable it; it is
  a human toggle in the panel UI.
- **ExtendScript host ported mechanically** from the old `.jsx` tree to `extension/src/jsx/**/*.ts`
  (unmodified handler bodies, shared `extension/src/jsx/core/state.ts` namespace), compiled to ES3 by
  bolt-cep's Babel pipeline. Not rewritten, to avoid behaviour drift.
- **Installer installs from source** (`codeload.github.com` zip), not npm, because the package is unpublished
  (`npx -y offhand-mcp` → 404).
- **`0.1.0` is framed honestly as a public preview** with a known-limitations section, not a finished product.
- **Phase E (0.2.0) makes writes observable and reads cheap** rather than adding breadth: every write
  returns a `changed` map (`{field:{from,to}}`), creators return `created`, removals `removed`, and no-op
  writes return a `note` instead of a silent success. Reads default to `detail: "min"` and keep `"full"` as
  an explicit opt-in.
- **Layers are addressed by stable uid** (`"L42"`), because names and indexes drift when a user
  renames or reorders. `findLayer` accepts uid or name; indexes are rejected.
- **`batch` exists to cut round trips, not to expand power.** It runs at most 20 handler calls, cannot
  nest, shares one undo group, and the panel's security gate scans the call list for `execute` — so the
  raw-script switch cannot be bypassed by packing it into a batch.
- **Render jobs survive panel reloads:** `render queue` records a job, `start` schedules
  `rq.render()` through `app.scheduleTask` and returns, queue items (including finished ones) are adopted,
  and `jobs` reports state. The scheduled script writes a temp status marker; while it says
  `rendering`, `jobs`/`status` are answered from cached state without touching AE. Dialogs are
  suppressed around the render. Long renders still occupy AE once the scheduled task begins.
- **The typed surface grows from evidence:** `offhand patterns` groups repeated `execute` reasons from
  `usage.jsonl` and suggests the tool that should absorb them.

---

## 4. State of the work

### Complete and verified

| Phase | Contents | Commit |
| --- | --- | --- |
| A | bolt-cep scaffold; panel loads in AE 2023 | `f3f02dd` |
| B | flipped bridge (panel hosts socket), verified live | `464ef5b` |
| C | settings + raw-script gate | `cf3ff77` |
| D | ExtendScript host ported to `src/jsx` | `e3a8d3f` |
| — | CI test fix | `71686ec` |
| — | Release prep: installer, docs, changelog | `62472a4` |
| — | `CONTEXT.md` handoff snapshot (this file) | `9ec6de0` |
| — | Ruleset note + PR flow docs (PRs #9, #10) | `08b42b2`, `ba8168d` |
| E | Tool surface: stable ids, write diffs, `batch`, `detail`, render jobs, `offhand patterns` | 0.2.0 release |
| — | Hardening: layer uids, reorder by neighbor, scheduled renders, reload-safe job history | 0.3.0 release |
| — | Panel UI: Debug / Status / Log, local `node` MCP config via hello `clientPath` | 1.0.0 release |

Live-verified on **AE 2023 (23.6x62)**: bridge reaches `ready`; the full 15-tool surface has been
exercised through the real MCP → WS → panel queue → host chain (110-check sweep). The fixes that sweep
produced shipped in 0.2.0: runtime `RQItemStatus` labels, MP4/H.264 queue defaults, `assets import`
`path`/`paths` handling, `property set` read-back verification, 2D/3D vector reads, text fill/stroke
crashes and justification, read-only text attributes, shape fill target and `comp get` brevity. Render
was verified end to end (valid 32 KB MP4, PNG frame).

Checks: `typecheck` ✓ · **100 tests / 11 files** ✓ · `lint` ✓ · `build` ✓ · extension build ✓
(251.78 kB panel bundle; expected `eval` warnings from `core/json.ts` and `tools/execute.ts`). The
suite includes a mock AE object model (`tests/support/ae-mock.ts`), so every typed tool runs end to end
without After Effects.

### Release 1.0.0 — shipped

- Tag `v1.0.0` and GitHub Release with `offhand-panel-1.0.0.zip`.
- Panel is header + collapsible **Debug** + **Status** + **Log**, using the same dark palette; section
  labels are sentence case in the UI font.
- The MCP hello reports `clientPath`; Copy MCP config emits `node <path>/dist/cli.js` (the old npx
  command was unpublished). `AeSnapshot.selection.layers` now matches the uid shape.

### Release 0.3.0 — shipped

- Tag `v0.3.0` and GitHub Release with `offhand-panel-0.3.0.zip` (511,805 bytes).
- Layer uids replace indexes/numeric ids; `reorder` takes `before`/`after`; render start schedules with a
  status marker, cached polling, suppressed dialogs, and queue-item adoption after a panel reload.
- Live-verified on AE 2023: uid list/get/reorder/parent, 57 ms scheduled start, 15 ms cached `jobs`,
  valid 32 KB MP4, and 6 finished jobs retained after a panel reload.

### Release 0.2.0 — shipped

- Tag `v0.2.0` and GitHub Release with `offhand-panel-0.2.0.zip`.
- Phase E surface plus the live-sweep fixes listed above.
- 0.1.0 remains the first public preview.

### Release 0.1.0 — shipped

- Repo made **public**: <https://github.com/Flare-0/offhand>
- Tag `v0.1.0` pushed.
- GitHub Release **published**: <https://github.com/Flare-0/offhand/releases/tag/v0.1.0>
  with the release notes in the body and asset `offhand-panel-0.1.0.zip` (488,502 bytes).
  Release creation had to fight a GitHub incident (`HTTP 500/502` on releases, assets and topics); the
  draft cleanup failures left a successful release behind on retry.
- One-liner installer live over the public raw URL and verified by fetching it.

### Known gaps

- A long render occupies After Effects while it runs; there is no progress stream or cancel action.
- A `batch` that fails midway leaves earlier calls applied (one undo group, so one Ctrl+Z reverts them).
- The legacy `extension/host` tree and its `dist/cep/host` copy remain as a fallback; the bundled
  `src/jsx` host answers first, but the fallback should be removed once it has been unused for a while.
- macOS untested.
- Stale remote branch `docs/context-ruleset-note` (merged in #9) still exists; remove it only with the user's
  consent, since that is a delete command.
- CI annotates a Node 20 deprecation because `actions/checkout@v4` targets Node 20 on a Node 24 runner —
  worth a chore bump.

---

## 5. Next moves (in order)

1. **Phase F — testability** — the fake panel and mock AE host are done; add the 10–20 task eval set and
   use it to measure success rate, tool calls, tokens and `execute` usage.
2. Phase G — `offhand install`, `offhand doctor --fix`, audit-log surfacing.

---

## 6. Key files

| Path | Role |
| --- | --- |
| `src/cli.ts` | entry point, `doctor` subcommand, `OFFHAND_HOME` override |
| `src/server/server.ts` | MCP server, tool registry, bridge wiring; never writes stdout |
| `src/server/bridge.ts` | dial-in WS client, retries with backoff, diagnosis codes |
| `src/server/tools/*` | one file per tool (zod schema + handler), `registry.ts` lists all 15 |
| `src/server/log.ts` | JSONL usage log + `readExecutePatterns`/`suggestTool` for promotion |
| `src/shared/protocol.ts` | protocol v2 types (panel keeps a deliberate copy) |
| `src/shared/paths.ts` | `bridge.json`, token, log paths; atomic writes with Windows retry |
| `extension/src/js/main/main.tsx` | panel UI (state chip, log, Reconnect, permissions) |
| `extension/src/js/bridge/server.ts` | panel WS server, serialized host-call queue, settings gate |
| `extension/src/jsx/host.ts` | dispatcher: parse args, undo group, serialize result |
| `extension/src/jsx/core/state.ts` | shared ExtendScript namespace (`tools`, `writeTools`, `json`, `util`, `jobs`) |
| `extension/src/jsx/core/util.ts` | resolution, `diff`/`track`/`layerBrief`, `#id` selectors, paging |
| `extension/src/jsx/tools/batch.ts` | sequential composition of handlers (max 20, no nesting) |
| `extension/cep.config.ts` | extension id, `AEFT [23.0,99.9]`, `--enable-nodejs`, `installModules: ["ws"]` |
| `scripts/setup-windows.ps1` | public one-liner installer |
| `scripts/install-cep.mjs` | copies `extension/dist/cep` → `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel`, sets `PlayerDebugMode` |
| `docs/install.md` | requirements, one-liner, MCP configs, troubleshooting table |
| `docs/architecture.md` | current topology, protocol, failure modes, UXP migration |
| `CHANGELOG.md` | 0.1.0 preview + 0.2.0 (Phase E) notes |
| `ROADMAP.md` | phases A–H; A–E checked |
| `AGENT.md` | standing rules, per-phase "done" notes, gotchas |

---

## 7. Operational notes and gotchas

- **Rebuilding `dist/cli.js` requires restarting the MCP client** (or disabling/enabling the server entry);
  otherwise the old process keeps running.
- MCP entry used during development points at `dist/cli.js` via `node`, not at an npm package.
- **Re-running `npm run install:cep` copies over the panel.** On AE 2023 a real directory at the target path
  breaks `--link` with `EINVAL readlink`. Use the copy install there.
- `PlayerDebugMode = 1` is needed under `HKCU\Software\Adobe\CSXS.9` … `CSXS.13`; the installer writes all
  five. Without it, an unsigned panel does not appear in **Window → Extensions**.
- **Render-queue status numbers are runtime values.** Never hardcode them; read `RQItemStatus` from the
  AE global. On 23.6, `3013` = `NEEDS_OUTPUT`, `3015` = `QUEUED`, `3019` = `DONE`.
- **Text justification** must be assigned the `ParagraphJustification` enum (or its numeric constant), not
  a raw string. `fauxBold`, `fauxItalic` and `allCaps` are read-only in AE 23.6; use a bold/italic font or
  capitals instead.
- **Render output defaults to MP4/H.264.** A `.mp4` output with no `outputModule` auto-applies the
  installed H.264 template; other formats need an explicit request.
- The panel only loads at After Effects startup — restart AE after installing.
- `%APPDATA%\offhand` holds `token`, `bridge.json`, `settings.json`, `logs/usage.jsonl`. A stale token from
  another install causes `TOKEN_MISMATCH`; deleting that one file (or re-running the installer) fixes it.
- Dataset paths are per-user; nothing is installed system-wide, no services or scheduled tasks.
- **`main` is protected by two owner rulesets**: `main-1` (no deletion, no force-push) and `main-2`
  (pull request + the `test` status check). The required approving review was lowered to **0** on
  2026-11-25 because the repo is solo, so a green PR merges normally. Work flow: branch → PR → wait for
  `test` → `gh pr merge --squash`. A direct push still lands via the admin bypass, but prints
  `Bypassed rule violations` and skips the gate.
- Repo topics are applied: `mcp, after-effects, adobe, extendscript, cep, ai, automation, nodejs`
  (`gh repo edit Flare-0/offhand --add-topic …`; this failed with HTTP 500 during the incident and succeeded
  once it cleared).

---

## 8. Environment

- Windows 10/11, Node 20+, After Effects 2023+.
- Repository root is the working directory; `main` is the release branch.
- Release assets and release notes are generated into the OS temp directory, never committed.
