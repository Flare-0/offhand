# CONTEXT.md — working context for offhand

> Snapshot of the project's state, decisions and next steps, written at each context compaction so a
> fresh agent session can pick up without re-deriving anything. Sanitized: no tokens, no secrets, no
> machine-specific absolute paths.
>
> Last updated: 2026-11-25 (release of `0.1.0`).

---

## 1. What this is

**offhand** (`offhand-mcp`) is an MCP server for Adobe After Effects. It exposes 14 typed tools so an
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

Live-verified on **AE 2023 (23.6x62)**: bridge reaches `ready`; `status`, `project` and `comp` work through
the full MCP → WS → panel queue → host chain. A second agent used the MCP successfully.

Checks at release: `typecheck` ✓ · **24 tests / 5 files** ✓ · `lint` ✓ · extension build ✓ (250.64 kB panel
bundle; expected `eval` warnings from `core/json.ts` and `tools/execute.ts`).

### Release 0.1.0 — shipped

- Repo made **public**: <https://github.com/Flare-0/offhand>
- Tag `v0.1.0` pushed.
- GitHub Release **published**: <https://github.com/Flare-0/offhand/releases/tag/v0.1.0>
  with the release notes in the body and asset `offhand-panel-0.1.0.zip` (488,502 bytes).
  Release creation had to fight a GitHub incident (`HTTP 500/502` on releases, assets and topics); the
  draft cleanup failures left a successful release behind on retry.
- One-liner installer live over the public raw URL and verified by fetching it.

### Known gaps

- Only `status`, `project`, `comp` have individual live smoke tests. The other 11 tools share the same code
  path but are unverified individually.
- Layers are addressed by name/index only — no stable layer IDs yet.
- No write diffs, no `batch` tool, no `detail: min|full`, no render jobs (all Phase E).
- Repo topics were never applied (the Topics API was 500 during the incident). Desired:
  `mcp, after-effects, adobe, extendscript, cep, ai, automation, nodejs`.
- Phase D bundled host not yet re-verified live after a panel reload (legacy `dist/cep/host` fallback is
  still present, so a failure would be masked — check the log to confirm which host answered).
- macOS untested. npm publish is Phase H.

---

## 5. Next moves (in order)

1. **Live-check the Phase D host** — reload the panel (flyout → Reload) or restart AE, then run `status` and
   a couple of writes through the new bundled host. Confirm from the log that `src/jsx` answered, not the
   legacy fallback.
2. **Re-apply repo topics** once the API is healthy (command in §7).
3. **Phase E — tool surface:** stable layer IDs, write diffs, `batch`, `detail: min|full`, render jobs, and
   promoting repeated `execute` patterns into typed tools.
4. Phase F — testability: expand the fake panel, mock AE object model, a 10–20 task eval set.
5. Phase G — `offhand install`, `offhand doctor --fix`, audit-log surfacing.
6. Phase H — npm publish.

---

## 6. Key files

| Path | Role |
| --- | --- |
| `src/cli.ts` | entry point, `doctor` subcommand, `OFFHAND_HOME` override |
| `src/server/server.ts` | MCP server, tool registry, bridge wiring; never writes stdout |
| `src/server/bridge.ts` | dial-in WS client, retries with backoff, diagnosis codes |
| `src/server/tools/*` | one file per tool (zod schema + handler) |
| `src/shared/protocol.ts` | protocol v2 types (panel keeps a deliberate copy) |
| `src/shared/paths.ts` | `bridge.json`, token, log paths; atomic writes with Windows retry |
| `extension/src/js/main/main.tsx` | panel UI (state chip, log, Reconnect, permissions) |
| `extension/src/js/bridge/server.ts` | panel WS server, serialized host-call queue, settings gate |
| `extension/src/jsx/host.ts` | dispatcher: parse args, undo group, serialize result |
| `extension/src/jsx/core/state.ts` | shared ExtendScript namespace (`tools`, `writeTools`, `json`, `util`) |
| `extension/cep.config.ts` | extension id, `AEFT [23.0,99.9]`, `--enable-nodejs`, `installModules: ["ws"]` |
| `scripts/setup-windows.ps1` | public one-liner installer |
| `scripts/install-cep.mjs` | copies `extension/dist/cep` → `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel`, sets `PlayerDebugMode` |
| `docs/install.md` | requirements, one-liner, MCP configs, troubleshooting table |
| `docs/architecture.md` | current topology, protocol, failure modes, UXP migration |
| `CHANGELOG.md` | 0.1.0 preview notes |
| `ROADMAP.md` | phases A–H; A–D checked |
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
- The panel only loads at After Effects startup — restart AE after installing.
- `%APPDATA%\offhand` holds `token`, `bridge.json`, `settings.json`, `logs/usage.jsonl`. A stale token from
  another install causes `TOKEN_MISMATCH`; deleting that one file (or re-running the installer) fixes it.
- Dataset paths are per-user; nothing is installed system-wide, no services or scheduled tasks.
- **`main` is protected by a ruleset** (owner-enabled): changes are expected through a pull request and the
  `test` status check. A direct `git push` to `main` by the repo owner still lands, but prints
  `Bypassed rule violations`. Prefer a short-lived branch → PR → merge so CI gates the change.
- Desired repo topics (blocked earlier by the GitHub incident):
  `gh repo edit Flare-0/offhand --add-topic mcp --add-topic after-effects --add-topic adobe --add-topic extendscript --add-topic cep --add-topic ai --add-topic automation --add-topic nodejs`

---

## 8. Environment

- Windows 10/11, Node 20+, After Effects 2023+.
- Repository root is the working directory; `main` is the release branch.
- Release assets and release notes are generated into the OS temp directory, never committed.
