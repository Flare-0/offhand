# AGENT.md — offhand

> **For AI agents continuing work on this project.**
> Read this file first. Then read `DESIGN.md` for architecture detail.

## What this project is

**offhand** (`offhand-mcp` on npm) is an MCP server for Adobe After Effects on Windows.
It lets an AI agent control After Effects through typed, high-level tools — without writing ExtendScript 95% of the time.

Repo: `git@flare:Flare-0/offhand.git` (private, SSH alias `flare` → github.com, account Flare-0)

---

## ⚠️ ACTIVE WORK: bolt-cep rewrite (started 2026-11-25) — read this first

The CEP extension is being **rewritten from scratch on bolt-cep** (React + Vite + TypeScript) and the
bridge is being **flipped**. The full plan, decisions and rationale live in
[`ROADMAP.md`](ROADMAP.md) § *ACTIVE: bolt-cep rewrite* — **read that section before coding.**

### What changed in the plan
- **Socket flips.** The panel (long-lived, in AE) will *host* the WebSocket and write `bridge.json`
  with Node `fs`; the MCP stdio server (short-lived) will *dial in*. This removes `cep.fs` from the
  config path entirely, which was the root cause of the "Waiting for server" dead-end.
- **State machine** replaces the `connecting` boolean that made Reconnect a permanent no-op.
- **ExtendScript moves to TS** under `extension/src/jsx/`, compiled to ES3 by bolt-cep, called via
  `evalTS()` — killing the ES3 hand-writing burden and the TS/JSX drift.
- Plus protocol deadlines, a `batch` tool, stable layer IDs, a fake panel + mock AE for CI, and a
  panel-level "Allow raw scripts" toggle for `execute`.

### Rules for this rewrite
1. **Commit and push incrementally** — after every phase. AI usage can run out mid-session, so an
   uncommitted phase is a lost phase. Update `ROADMAP.md` + `AGENT.md` in the same commit.
2. Do **not** delete the legacy `extension/client` + `extension/host` code until the bolt-cep
   equivalent builds and has been smoke-tested in AE.
3. Target **AE 2023+** (`hosts: [{ name: "AEFT", version: "[23.0,99.9]" }]`) — bolt-cep's README says
   2024+, but this project runs on After Effects 2023 (23.6).
4. Keep the MCP server (`src/`) working at every commit; the panel rewrite must not break `npm test`.

### bolt-cep
- Repo: `https://github.com/hyperbrew/bolt-cep` (branch `master`). Scaffold logic is in
  `create-bolt-cep/src/index.ts`.
- A shallow clone may exist at `C:\Users\Muaj\AppData\Local\Temp\opencode\bolt-cep` — re-clone if gone.
- Key files once scaffolded: `extension/cep.config.ts` (hosts/panels/parameters),
  `extension/vite.config.ts` + `vite.es.config.ts` (panel build + ES3 rollup of `src/jsx`),
  `extension/package.json` (from `package.react.jsonc`), `extension/tsconfig.json` (from
  `tsconfig.react.json`).
- `parameters` must keep `--enable-nodejs` and `--mixed-context` — the panel needs real `fs`/`net`.

### ✅ Phase A done (2026-11-25) — bolt-cep scaffold builds and loads in AE 2023

What exists now:
- `extension/` **is** a bolt-cep React project (`offhand-panel@0.1.0`, `"type": "module"`), with its
  **own** `package.json` / `node_modules` (569 packages) — deliberately separate from the lean MCP
  server deps at the repo root.
- `extension/cep.config.ts` → `id: com.offhand.panel`, `displayName: offhand`, hosts
  `[{ name: "AEFT", version: "[23.0,99.9]" }]`, `extensionManifestVersion: 7.0`,
  `requiredRuntimeVersion: 9.0`, `parameters: ["--v=0","--enable-nodejs","--mixed-context"]`,
  panel `name: "offhand"` (380×480), `installModules: ["ws"]`, `symlink: "local"`.
- Build output: **`extension/dist/cep/`** — this folder *is* the CEP extension root
  (`CSXS/manifest.xml`, `main/index.html`, `assets/*.cjs`, `jsx/index.js`, `node_modules/ws`).

Commands:
```powershell
# repo root
npm run build:extension        # → extension/dist/cep
npm run install:cep            # copies dist/cep → %APPDATA%\Adobe\CEP\extensions\com.offhand.panel
npm run install:cep -- --link # junction instead of copy (dev)
npm run install:cep -- --uninstall

# inside extension/ (bolt-cep's own flow)
npm run build                  # rimraf dist && tsc -p tsconfig-build.json && vite build
npm run symlink                # junction → %APPDATA%\Adobe\CEP\extensions\com.offhand.panel
npm run dev                    # vite HMR for the panel
```

Verified live: the install was a **junction** (`extension/dist/cep`), AE 2023 (23.6) was launched and
the **offhand panel loaded** (user-confirmed).

Gotchas already hit — do not rediscover them:
1. The *old* `com.offhand.panel` was a real directory, which made bolt-cep's symlink fail with
   `EINVAL: invalid argument, readlink`. **Delete the target folder first**, then symlink.
2. Copying the scaffold by hand (rather than `npx create-bolt-cep`) means the marker stripping is
   yours to do: `src/js/main/index.html` must load `./index-react.tsx`, and `src/jsx/index.ts` must
   not import the deleted `./ame/ame`, `./ppro/ppro`, … modules. Both broke the first build.
3. The template's `./src/assets/light-icon.png` / `dark-icon.png` do not exist — copy them in
   (`assets/icon-1024.png` works) or the manifest references dead icon paths. **Fixed in Phase B**:
   `copyAssets` now copies both icons into `dist/cep/assets/`.

Still legacy / still in the repo: `extension/CSXS`, `extension/client`, `extension/host` — kept as
the porting source for phases C and D (rule 2 above). The manifest in use is the generated one.

### ✅ Phase B done (2026-11-25) — bridge flipped, protocol v2

**The socket now lives in the panel.** The panel publishes `%APPDATA%\offhand\bridge.json` and listens;
the MCP server reads that file and dials in. `cep.fs` is gone from the config path, so the old silent
"Waiting for server" failure cannot recur.

Where things are:
- `src/shared/protocol.ts` — **protocol v2**. MCP server sends `hello {protocol, token, clientVersion}`;
  panel replies `welcome {protocol, panelVersion, ae}`. Calls carry `timeoutMs` **and** an absolute
  `deadline`; results carry `{ok, data}` or a serialized error.
- `src/shared/paths.ts` — `bridge.json` v2 (`{version:2, protocol, host, port, token, pid,
  panelVersion, startedAt}`), atomic write, race-safe token (`flag:"wx"`), and
  `readBridgeConfigFile()` → `ok | missing | legacy | malformed` so the server can diagnose.
- `src/server/bridge.ts` — dial-in **client**, `start()` is non-blocking so the MCP server boots with
  AE closed. Backoff 300 ms → 2 s, connect/handshake deadlines, heartbeat, serialized calls;
  a call timeout sets diagnosis `AE_BUSY` (means "a modal dialog is probably blocking AE").
- `src/server/tools/status.ts`, `src/server/doctor.ts`, `src/cli.ts` — report diagnosis + hint
  (`PANEL_NOT_RUNNING`, `BRIDGE_STALE`, `TOKEN_MISMATCH`, `VERSION_MISMATCH`, `AE_BUSY`) instead of
  `connected: false`. `OFFHAND_PORT` no longer exists; only `OFFHAND_HOME`.
- `extension/src/js/bridge/types.ts` — **deliberate duplicate** of the shared protocol types; the
  panel is a separate tsconfig root and cannot import repo-root `src/shared`. Keep the two in sync.
- `extension/src/js/bridge/config.ts` — panel-side paths/token/`bridge.json` (port 47823, falls back
  to an ephemeral port if taken).
- `extension/src/js/bridge/server.ts` — `PanelBridge`: `ws` server, 5 s auth window, token + protocol
  checks (close codes 4001–4004), `welcome` with cached AE snapshot, 15 s ping / 45 s pong, and a
  **serialized host-call queue** with per-call deadlines (late results are dropped).
- `extension/src/js/bridge/host.ts` — `callHost()` → `evalTS("dispatch", tool, JSON.stringify(args))`.
- `extension/src/jsx/aeft/aeft.ts` — `dispatch(tool, argsJson)` lazily `$.evalFile`s
  `dist/cep/host/offhand.jsx` and forwards; returns `HOST_UNAVAILABLE` if the legacy host is missing.
  This is the bridge to **Phase D**, which ports `host/**/*.jsx` into `src/jsx/**/*.ts`.
- `vite.plugin.host.ts` — copies `extension/host/` → `dist/cep/host/` at build time (`copyAssets`
  resolves under `extension/src`, so it cannot be used for this).
- `extension/src/js/main/main.tsx` + `main.scss` — minimal panel: state chip, endpoint, client count,
  AE project/comp, activity log, Reconnect (`bridge.restart()`), Copy MCP config.

**Verified live (AE 2023, 23.6x62):** panel published `bridge.json` on `127.0.0.1:47823`; the MCP
server reported `state: "ready"` and `status` returned the real project (`Untitled`, no comp) through
MCP → WS → call queue → `evalTS` → legacy host. With AE closed, `status` returns `PANEL_NOT_RUNNING`.

**Trap hit live:** the panel writes `startedAt` as **epoch ms (number)**; the server's validator
required a string, so a perfectly good `bridge.json` was classified `malformed` → `BRIDGE_STALE`.
`src/shared/paths.ts` now accepts both and normalizes to string (`tests/paths.test.ts` covers it).
Any future field added to `bridge.json` must be checked against what `extension/src/js/bridge/config.ts`
actually writes — the two sides share no code.

### ✅ Phase C done (2026-11-25) — panel UI, persisted settings, raw-script gate

The panel is no longer a status readout; it owns one security decision.

- `extension/src/js/bridge/settings.ts` — `%APPDATA%\offhand\settings.json`, `{allowRawScripts:false}`
  by default. Atomic tmp+rename write (same Windows `EPERM/EBUSY/EACCES` retry as `bridge.json`);
  `loadSettings()` never throws.
- **The gate is panel-side**, in `PanelBridge.enqueueCall`: with raw scripts off, an `execute` call is
  answered synchronously with `EXECUTE_DISABLED` and a hint naming the toggle — the script never
  reaches ExtendScript. It is deliberately not an MCP-settable flag: an agent must not be able to
  unlock itself. `PanelBridge.setAllowRawScripts()` is called only from the React toggle.
- Protocol additions (still v2, additive): `welcome` includes `settings`; toggling broadcasts
  `{type:"event", event:"settings", data:{allowRawScripts}}`; `src/server/bridge.ts` caches it and
  `status` returns `bridge.allowRawScripts`. `src/shared/protocol.ts` gained `PanelSettings` and
  `BridgeStatus.allowRawScripts`; `EXECUTE_DISABLED` was added to `OffhandErrorCode`.
- UI (`extension/src/js/main/main.tsx` + `main.scss`): Permissions card with the switch and a warning
  when on; AE card shows project (+ dirty marker), comp size/fps/layer count/playhead/duration;
  empty state tells the user to open a composition. System fonts only.
- `tests/bridge.test.ts` asserts the flag arrives in `welcome` and follows a live `event`.

**Checks:** root `typecheck`, `npm test` (**5 files / 24 tests**), `lint`, `build`; extension `build`
(44 modules, `host/` copy + `ws` + icons present). **Live panel reload not yet observed** — the panel
loads the bundle once, so rebuild + reload the panel (flyout menu) or restart AE.

**Next phase: D — port `extension/host/**/*.jsx` to `extension/src/jsx/**/*.ts`** (typed handlers,
still called through `evalTS`; undo groups preserved).

**Important:** `offhand-mcp` is **not published** (`npm view offhand-mcp version` → 404). MCP clients
must run `node D:/Projects/offhand/dist/cli.js`. The panel's "Copy MCP config" button still emits the
`npx -y offhand-mcp` form for after Phase H. Also: after rebuilding `dist/cli.js`, the MCP client must
be restarted (in OpenCode, remove + re-add the server entry) — it keeps running the old code otherwise.

### ✅ Phase D done (2026-11-25) — host ported into `src/jsx`

The ExtendScript host now ships inside the bolt-cep bundle instead of a hand-copied ES3 tree.

- `extension/src/jsx/core/state.ts` — shared mutable namespace (`Offhand.tools`, `writeTools`,
  `json`, `util`). Each ported module imports it and registers into it, so the proven ES3 handler
  bodies moved over **unchanged**; the port was mechanical, not a rewrite. Tighten types per handler
  as you touch them.
- Ported files: `core/json.ts`, `core/util.ts`, and `tools/{assets,comp,effect,execute,layer,mask,
  project,property,render,shape,status,text,view}.ts`.
- `extension/src/jsx/host.ts` — the single dispatcher: parse args → handler → `{ok,data}` or
  `{ok:false,error}`; one `beginUndoGroup`/`endUndoGroup` around every tool in `writeTools`; keeps
  `INVALID_JSON`, `UNKNOWN_TOOL` and `HOST_ERROR` behaviour.
- `extension/src/jsx/aeft/aeft.ts` — exports `dispatch` → bundled dispatcher. If it ever returns
  `UNKNOWN_TOOL`, it retries `dist/cep/host/offhand.jsx`, so a missed registration can't strand a
  call. **The legacy `extension/host/` tree is still in the repo** (not deleted, per the phase-A
  rule) and is still copied into `dist/cep/host/` by `vite.plugin.host.ts` — that copy is now only
  the fallback, and can be removed in a later phase once live verification is done.
- ES3: verified in the built bundle — no `=>`, `??`, `?.`, `let`/`const`; no ES5 builtins added by
  the new modules. Babel + ponyfills emit ES3. Bundle is `dist/cep/jsx/index.js` (~100 KB) and the
  build log shows `44 modules transformed`.
- `tests/tools.test.ts` still passes because the legacy `.jsx` files remain.

**Checks:** root `typecheck`, `npm test` (5 files / 24 tests), `lint`; extension `build` green.
**Live reload not yet observed** — the panel evaluates the jsx bundle once, so reload the panel from
its flyout menu (or restart AE) before trusting the ported handlers in AE.

---

### ✅ Phase E done (2026-11-28) — tool surface, 0.2.0 released

The tools now behave like an agent surface rather than API wrappers. All of this is on **both** sides
(host handler + server schema) and covered by tests.

- **Stable ids.** `layerInfo` includes `id`; `layerBrief` is `{id,index,name,type,enabled,locked,selected}`.
  `findLayer` accepts `number | string | {id}` and strings `#42` / `id:42`; `findLayerById` fails
  `NOT_FOUND` with a `layer action="list"` hint. Documented default: address by id.
- **Diffs.** `core/util.ts` has `clone`, `same` (via `Offhand.json.stringify`), `diff(before,after)`
  → `{field:{from,to}}`, and `track(target, fields)` which snapshots then commits. Write tools return
  `changed`; `create` returns `created`; `delete`/`remove` return `removed`; no-op writes return
  `note: "No values changed."` — never a silent success.
- **`detail: min|full`** on `layer`, `comp`, `project`, `property`. `min` (default) is brief ids +
  essentials; `full` is the old verbose payload. Implemented in the handlers, not in the server.
- **`batch`** (15th tool). `extension/src/jsx/tools/batch.ts` + `src/server/tools/batch.ts`. Max 20
  sequential calls, `stopOnError` default true, no nesting, one undo group. **Security:** the panel's
  `blockedBySecurityGate()` scans `args.calls` for `execute`; disabled raw scripts block the whole
  batch with `EXECUTE_DISABLED`.
- **Render jobs.** `Offhand.jobs` (`j1`, `j2`, …) with `queued|rendering|done|failed`, `queuedAt`,
  `startedAt`, `finishedAt`, `ms`, `error`; `syncJob` maps AE queue status strings. Actions:
  `frame`, `queue` (+`start:true`), `start`, `jobs`, `status`, `clear`. `start` calls the blocking
  `rq.render()` — be honest with users about that.
- **Execute promotion.** `src/server/log.ts` exports `readExecutePatterns(limit)` and
  `suggestTool(reason)`, grouping by normalised `reason` (the logged script is replaced by
  `<N chars>`). `offhand patterns` prints them; `docs/tools.md` documents the promotion loop.
- **Tests.** `tests/tools.test.ts` now asserts 15 tools and checks handlers exist in
  `extension/src/jsx/tools/` (the `.jsx` fallback is no longer the contract); new
  `tests/patterns.test.ts`, `tests/host-eval.test.ts`, `tests/host-property.test.ts`,
  `tests/host-assets.test.ts`, `tests/support/ae-mock.ts` and `tests/versions.test.ts`.
  **10 files / 84 tests.** Versions bumped to 0.2.0 in root, extension,
  `src/shared/version.ts` and `core/state.ts`.

**Checks:** `typecheck`, `test` (10/84), `lint`, `build` (74.6 KB cli), `build:extension`
(251 KB panel) all green; `eval` warnings from `core/json.ts` / `tools/execute.ts` are expected.

**Live AE pass complete (2026-11-28, AE 23.6x62).** Every one of the 15 tools was exercised through the
real MCP → WebSocket → panel queue → host chain. The sweep found and fixed, in the same release:

- `RQItemStatus` labels were wrong from the hardcoded table; they now come from AE's runtime constants
  (on 23.6: `3013` = `NEEDS_OUTPUT`, `3015` = `QUEUED`, `3019` = `DONE`).
- `render queue` with a `.mp4` output now applies the installed H.264 output-module template when no
  `outputModule` is given. Always recommend MP4/H.264 in docs unless the user asks for another format.
- `assets import` accepts `path` or `paths`, a string or array, and never passes `undefined` to `fileFor`.
- `property set` reads the value back and fails `INVALID_STATE` if the write was a no-op.
- `text set` uses the `ParagraphJustification` enum; `fauxBold`/`fauxItalic`/`allCaps` are rejected with a
  clear `INVALID_ARGS` because AE exposes them read-only; the false "No values changed." note is gone.
- Vector values (`shape size`, mask `feather`, `transform.scale`) read as numeric arrays even when AE
  reports no enum value type; 2D writes are padded to 3D.
- `render start` verified end to end: a 3 s comp produced a valid 32 KB MP4 (`ftyp mp42`), and
  `render frame` produced a PNG.

**Next phase: F — testability.** The fake panel and mock AE host are in place; what remains is the
10–20 task eval set that measures success rate, tool calls, tokens and `execute` usage.

---

## Current state (session ended 2026-11-24 ~23:00)

> ⚠️ **Stale section.** The tool table below says the 11 typed tools are stubs — that is wrong as of
> commit `e64a770`. All 14 tools are implemented on **both** sides (TS + JSX) and tests pass
> (4 files, 17 tests). See `ROADMAP.md` § *All 14 MCP Tools* for the accurate list.

### What is DONE and committed ✅

| Area | Status |
|---|---|
| Project scaffold (package.json, tsconfig, tsup, vitest, eslint, prettier) | ✅ committed |
| `src/shared/errors.ts` — `OffhandError`, error codes, serialization | ✅ |
| `src/shared/protocol.ts` — all WebSocket message types, `AeSnapshot`, `BridgeStatus` | ✅ |
| `src/shared/paths.ts` — `appDataDir()`, token, bridge config read/write | ✅ |
| `src/shared/version.ts` — `VERSION`, `SERVER_NAME`, `PROTOCOL_VERSION` | ✅ |
| `src/server/bridge.ts` — full WebSocket bridge with auth, heartbeat, pending call map, hardened reconnect | ✅ |
| `src/server/log.ts` — JSONL usage log to `%APPDATA%\offhand\logs\usage.jsonl` | ✅ |
| `src/server/server.ts` — McpServer wiring, tool registration loop, graceful shutdown | ✅ |
| `src/server/doctor.ts` — `doctor()` report (paths, AE installs, CEP state) | ✅ |
| `src/server/tools/types.ts` — `ToolDefinition`, `ToolContext`, `ToolTextResult` | ✅ |
| `src/server/tools/result.ts` — `textResult()`, `errorResult()`, `capText()` | ✅ |
| `src/server/tools/registry.ts` — exports `TOOLS` array | ✅ |
| **`status` tool** — bridge health + AE snapshot; read-only, no bridge call if offline | ✅ |
| **`docs` tool** — search/get bundled AE scripting reference (`action="search"\|"get"`) | ✅ |
| **`execute` tool** — raw ExtendScript escape hatch; requires `reason`, logs it | ✅ |
| `src/server/data/ae-docs.ts` — curated AE scripting reference entries | ✅ |
| `src/cli.ts` — CLI entry (`offhand`, `offhand doctor`, `offhand install`, `offhand --version`) | ✅ |
| `extension/CSXS/manifest.xml` — CEP manifest, `com.offhand.panel`, AE 2023+ | ✅ |
| `extension/client/index.html`, `panel.js`, `styles.css` — CEP panel UI | ✅ |
| `extension/host/offhand.jsx` — `Offhand.dispatch()`, `Offhand.include()`, load guard | ✅ |
| `extension/host/core/json.jsx` — ES3 JSON polyfill | ✅ |
| `extension/host/core/util.jsx` — `Offhand.util`: `fail()`, `project()`, `findComp()`, `findLayer()`, `time()`, `color()` | ✅ |
| `extension/host/tools/status.jsx` — host status handler | ✅ |
| `extension/host/tools/execute.jsx` — host execute handler with undo group | ✅ |
| `extension/host/tools/comp.jsx` — host comp stub (exists, not wired) | ✅ (file exists) |
| `extension/host/tools/layer.jsx` — host layer stub (exists, not wired) | ✅ (file exists) |
| `extension/host/tools/project.jsx` — host project stub (exists, not wired) | ✅ (file exists) |
| `scripts/install-cep.mjs` — installs extension to `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel` | ✅ |
| `scripts/smoke.mjs` — smoke test | ✅ |
| `docs/architecture.md`, `docs/tools.md`, `docs/security.md`, `docs/recipes.md` | ✅ |
| `README.md` — full README with logo, tools table, quickstart | ✅ |
| `assets/logo.svg`, `assets/logo-mark.svg`, `assets/banner.svg` etc. | ✅ (generated by subagent) |
| `.github/workflows/ci.yml` — CI: typecheck + test + build on windows-latest | ✅ |
| All tests pass (`npm test`: 2 files, 10 tests) | ✅ |
| Lint clean | ✅ |
| Remote: `git@flare:Flare-0/offhand.git` on `main` | ✅ pushed |

### What is NOT done yet — the next phase ❌

The **planned tools** in `docs/tools.md` are **all stub / not implemented**:

| Tool | Server-side (TS) | Host-side (JSX) |
|---|---|---|
| `project` | ❌ | ❌ (stub file exists) |
| `comp` | ❌ | ❌ (stub file exists) |
| `layer` | ❌ | ❌ (stub file exists) |
| `property` | ❌ | ❌ |
| `effect` | ❌ | ❌ |
| `text` | ❌ | ❌ |
| `shape` | ❌ | ❌ |
| `mask` | ❌ | ❌ |
| `render` | ❌ | ❌ |
| `assets` | ❌ | ❌ |
| `view` | ❌ | ❌ |

The session ended while the agent was planning the implementation of these tools.

---

## How to work on this project

### Prerequisites

```powershell
# Node 20+, After Effects 2023+ (Windows only)
npm install
npm run build
npm run install:cep   # copies extension to %APPDATA%\Adobe\CEP\extensions
# Restart After Effects → Window → Extensions → offhand
```

### Dev loop

```powershell
npm run dev           # tsup --watch, rebuilds on change
npm run typecheck     # tsc --noEmit
npm test              # vitest run (unit tests only; no AE needed)
npm run lint          # eslint
```

### MCP config (local dev)

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

---

## Adding a new tool — the pattern

Every tool requires **two** implementations:

### 1. Server-side TypeScript (`src/server/tools/<name>.ts`)

```ts
import { z } from 'zod';
import { textResult } from './result.js';
import type { ToolDefinition } from './types.js';

export const myTool: ToolDefinition = {
  name: 'my_tool',
  title: 'Human title',
  description: 'What it does. When to use it. What it returns.',
  inputSchema: {
    action: z.enum(['list', 'get', 'create', 'set']).describe('...'),
    comp: z.union([z.string(), z.number()]).optional().describe('Comp name or id.'),
    // ...
  },
  annotations: {
    readOnlyHint: false,    // set true for reads
    destructiveHint: false, // set true for deletes
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(args, context) {
    const data = await context.bridge.call('my_tool', args);
    return textResult(data);
  },
};
```

Then add it to `src/server/tools/registry.ts`:
```ts
export const TOOLS: ToolDefinition[] = [statusTool, docsTool, executeTool, myTool];
```

### 2. Host-side ExtendScript (`extension/src/jsx/tools/<name>.ts`)

```ts
Offhand.tools.my_tool = function (args) {
  var comp = Offhand.util.comp(args.comp);
  var changed = {};
  var commit = Offhand.util.track(target, ["name"]);
  // ... AE API calls ...
  changed = commit();
  return { changed: changed };
};
```

If it's a write tool, add it to `Offhand.writeTools` in `extension/src/jsx/core/state.ts`
(that object is the single source — the dispatcher no longer lives in a `.jsx` file):

```ts
writeTools: { execute: true, my_tool: true },
```

Then register the module for its side effect in `extension/src/jsx/host.ts`:

```ts
import "./tools/my_tool";
```

> Phase D moved the host into `src/jsx`. `extension/host/**/*.jsx` is legacy fallback only — do not
> add new handlers there. Keep new host code ES3 at runtime (no `Array.prototype.map`, `Object.keys`,
> `trim`, arrow functions, template literals); Babel handles syntax, not missing builtins.
>
> Phase E added the conventions every new tool must follow: accept `detail: min|full` for reads,
> return `changed` from writes (via `Offhand.util.track`/`diff`), return `created`/`removed` for
> create/delete, accept `#id` layer selectors via `Offhand.util.findLayer`.

### 3. Document it in `docs/tools.md`

Move the tool from "Planned tools" to "Live tools" with its schema examples and return shape.

---

## Tool schemas — from `docs/tools.md`

The exact input shapes for the planned tools are already specified. See [`docs/tools.md`](docs/tools.md). Do not redesign; implement them as-is.

Key conventions (from `docs/tools.md`):
- `comp` parameter accepts name (string) or id (number); default = active comp
- `layer` parameter accepts name (string) or index (number); default = selected layer
- Times are **seconds** (not frames)
- Colors accept `"#rrggbb"` or `[r, g, b]` in 0–255 or 0–1
- All write tools run inside `app.beginUndoGroup("offhand: <name>")` (handled by dispatcher)
- Error format: `[CODE] message\nHint: ...` via `OffhandError` → `errorResult()`

---

## Key files to read before coding

| File | Why |
|---|---|
| `docs/tools.md` | Complete input/output specs for all planned tools |
| `docs/architecture.md` | System topology and design goals |
| `src/shared/protocol.ts` | WebSocket message types |
| `src/server/tools/status.ts` | Simplest example of a tool |
| `src/server/tools/execute.ts` | Example with timeout and bridge call |
| `extension/src/jsx/core/util.ts` | `Offhand.util` helpers (findComp, findLayer, findLayerById, diff, track, page) |
| `extension/src/jsx/host.ts` | The dispatcher and undo-group boundary |
| `extension/src/jsx/core/state.ts` | Shared host namespace, `writeTools`, render jobs |
| `extension/src/jsx/tools/status.ts` | Simplest host-side tool |
| `extension/src/jsx/tools/batch.ts` | Composition of other handlers (and the security caveat) |
| `tests/bridge.test.ts` | Bridge unit tests (fake panel over a real WebSocket) |
| `tests/patterns.test.ts` | `execute` usage-log analysis and tool suggestion |

---

## Constraints and rules

1. **Never write to stdout in the server** — only stderr (`logInfo`) and the JSONL log. Stdout is the MCP stdio transport.
2. **`execute` is the last resort** — do not expand it; build typed tools instead.
3. **Write tools must use `app.beginUndoGroup`** — the dispatcher handles this automatically for tools in `Offhand.writeTools`.
4. **Tool responses must be compact** — strip internal AE UUIDs, timestamps, null fields. Prefer human-readable names. Cap text at 50,000 chars via `capText()`.
5. **Actionable errors** — always include a `hint` with the next step. Example: `'No composition named "X". Call project with action="comps" to list compositions.'`
6. **Host JSX is ES3** — no arrow functions, no `const`/`let`, no template literals, no destructuring, no `Array.prototype.forEach` with arrow, no `JSON` (use `Offhand.json`).
7. **One panel at a time** — the bridge replaces the previous WebSocket connection when a new panel connects.
8. **Windows only for now** — paths use `%APPDATA%`, registry keys for CEP debug mode.
9. **No new npm dependencies without good reason** — keep the runtime lean (`@modelcontextprotocol/sdk`, `ws`, `zod`).
10. **Keep `CONTEXT.md` current** — every time the conversation is compacted, refresh `CONTEXT.md` with the
    state, decisions and next moves (sanitized: no tokens, secrets or machine-specific absolute paths), and
    commit it. It is the handoff document for a fresh session.

---

## Git workflow

`main` is protected by the owner's rulesets: no deletes, no force-pushes, and changes need a pull
request whose `test` status check passes. Direct pushes land through an admin bypass and print
`Bypassed rule violations`, so use the PR flow instead:

```powershell
git switch -c <type>/<short-slug>
git add <files>
git commit -m "<type>: <description>"
git push -u origin <type>/<short-slug>
gh pr create --fill            # or --title/--body
gh run watch                   # wait for the `test` check
gh pr merge --squash
git switch main; git pull --ff-only
```

The required-review rule is intentionally at 0 on this solo repo, so a green PR merges without an
admin override. Merge branches with `--delete-branch` if you want them cleaned up.

Commit types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`.

---

## Running tests

```powershell
npm test                 # run once
npm run test:watch       # watch mode
```

Tests live in `tests/`. They test the TypeScript layer only — no AE or CEP needed. The bridge tests spin up a real WebSocket server and a mock panel client.

---

## What to do next (suggested order)

Phases A–E are done and live-verified; the live plan is in [`ROADMAP.md`](ROADMAP.md) § *Rewrite phases*.

1. **Phase F — testability** — the fake panel and mock AE host already exist (`tests/bridge.test.ts`,
   `tests/support/ae-mock.ts`). Add the 10–20 task eval set and use it to measure success rate, tool
   calls, tokens and `execute` usage.
2. **Phase G — install/doctor** — `offhand install`, `offhand doctor --fix`, audit-log surfacing.
3. **Phase H — docs + npm publish** — then switch the MCP config from
   `node D:/Projects/offhand/dist/cli.js` to `npx -y offhand-mcp`.
