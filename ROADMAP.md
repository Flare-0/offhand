# offhand Roadmap & Project Status

A clear breakdown of what is built, what is verified, and what still needs to be built or tested.

---

## ⚠️ ACTIVE: bolt-cep rewrite (started 2026-11-25)

The CEP extension is being **rewritten from scratch on bolt-cep** (React + Vite + TypeScript), and the
bridge architecture is being **flipped**. Everything in "Rewrite plan" below is live work; the
"Legacy" sections describe the pre-rewrite system that still runs today.

### Why we are rewriting
1. The old panel never opened its WebSocket. Root cause: `readBridgeConfig()` used `cep.fs` to read
   `%APPDATA%\offhand\bridge.json` and silently returned `null` on any failure — the panel showed
   "Waiting for server" with **no error**, which is what made it undebuggable.
2. `if (connecting) return;` with **no timeout** made the Reconnect button a permanent no-op.
3. Hand-written ES3 `.jsx` host handlers can silently drift from `src/server/tools/*.ts`.

### Decisions confirmed with the user
- **Framework:** React. **Depth:** full rewrite (panel UI *and* ExtendScript host, both in bolt-cep).
- **Target:** After Effects 2023+ (host range `[23.0,99.9]`) even though bolt-cep README says 2024+.
- **Commits:** incremental — commit + push after every phase (AI usage can run out mid-session).
- **Docs:** update `ROADMAP.md` and `AGENT.md` every phase so another agent can continue.

### Architecture changes (design review, binding)
1. **Flip who owns the socket.** The panel (long-lived, lives in AE) hosts the WebSocket server and
   writes `bridge.json` using Node `fs` (bolt-cep enables `--enable-nodejs`). The MCP stdio server
   (short-lived, one per agent session) reads `bridge.json` with plain Node `fs` and dials in.
   - `cep.fs` is no longer used for config discovery → the original bug cannot recur.
   - Several MCP clients can connect at once; AE is the stable endpoint, so port conflicts vanish.
   - Distinct failure codes instead of `connected: false`: `PANEL_NOT_RUNNING` (no bridge.json),
     `BRIDGE_STALE` (connection refused), `TOKEN_MISMATCH`, `AE_BUSY` (modal dialog),
     `VERSION_MISMATCH`.
2. **State machine, not booleans.** `idle → listening → handshaking → ready → degraded`, a timeout on
   every transition, Reconnect always resets to `idle`. Never swallow errors into `null` — keep the
   last error and show it in the panel. `status` returns a diagnosis, not just `connected: false`.
   `offhand doctor` checks every hop: file exists → port open → handshake OK → host ping returns.
3. **Typed host calls.** ExtendScript moves to `extension/src/jsx/*.ts` (ES6 → ES3 compiled by
   bolt-cep) and is called with `evalTS()`. Shared zod schemas used by server, panel and host, so
   `tests/tools.test.ts`'s "matching .jsx exists" check becomes a compile-time guarantee.
   HMR on the panel means no more restarting AE to test UI changes.
4. **Protocol rules.** Every message carries `id`, `protocolVersion`, `deadline` → always return
   `TIMEOUT` rather than hanging. Calls are serialized in a panel-side queue (ExtendScript is
   single-threaded and blocks AE; concurrent calls interleave badly). After a timeout, report
   "AE may be blocked by a dialog". Slow operations (renders) return a `jobId` immediately and are
   polled via `render.status`, so they never hit the MCP client's timeout. Version handshake states
   mismatches explicitly with the fix.
5. **Tool surface: push the 95% goal.** Stable layer IDs instead of indexes (indexes shift and cause
   silent wrong-layer edits). Every write returns the new state as a compact diff
   (`{changed: {position: [[0,0],[100,50]]}}`) so no follow-up `get` is needed. New **`batch`** tool:
   several operations, one round trip, one undo group, rollback on failure (a "lower third" is ~8 ops).
   Responses opt into detail via `detail: "min"|"full"` + pagination, smallest by default.
   `render.frame` stays low-res by default so agents can check work cheaply. Close the loop on
   `execute`: review `usage.jsonl` and promote any pattern seen 3× into a typed tool.
6. **Testable without After Effects.** (a) A **fake panel** — a small WS client speaking the protocol
   with canned results, so CI exercises the full server path. (b) A **mock AE object model**
   (fake `app.project`, comps, layers) so host handlers get unit tests. (c) A **10–20 task eval set**
   ("add a text layer, animate opacity 0→100 over 1s, apply drop shadow") measuring success rate,
   tool calls, tokens and `execute` usage — this is what proves design changes help.
7. **Security & install.** Treat the `execute` blocklist as a speed bump (string concatenation
   bypasses patterns). Real control = a panel toggle **"Allow raw scripts" (off by default)** plus
   the audit log. Keep the 127.0.0.1 bind, token auth and Origin check. Add `offhand install` and
   `offhand doctor --fix` for the CEP folder, the debug-mode registry key and the stale-extension
   cache. Keep the host behind an interface — CEP is the legacy route and UXP state in AE is
   unverified, so the transport must stay swappable.

### Rewrite phases
- [x] **A. bolt-cep scaffold** — React project in `extension/`, id `com.offhand.panel`,
      AEFT `[23.0,99.9]`, builds to `extension/dist/cep/`. Root scripts wire
      `build:extension` / `install:cep`. **Verified: panel loads in AE 2023.**
      - Done: `cep.config.ts` retargeted (id, AEFT-only host `[23.0,99.9]`, manifest v7.0,
        CSXS 9.0, `--enable-nodejs`, 380×480, `installModules: ["ws"]`); icons copied to
        `src/assets/`; unused Vue/Svelte lines stripped from `vite.config.ts` and
        `src/jsx/index.ts`; `src/js/main/index.html` points at `index-react.tsx`;
        `extension/package.json` renamed `offhand-panel@0.1.0` with `ws` dep.
        `npm install` (569 pkgs) + `npm run build` green: manifest, jsx ES3 bundle,
        `ws` copied into dist, panel assets built.
      - **Old install cleared**: `%APPDATA%\Adobe\CEP\extensions\com.offhand.panel` was a real
        folder (blocking bolt-cep's symlink with `EINVAL readlink`); removed it, then
        `npm run symlink` created a junction → `extension/dist/cep`.
      - **Kept on purpose:** `extension/CSXS`, `extension/client`, `extension/host` are still in
        the repo as the porting source for phases C and D. They are *not* loaded — the manifest
        in use is `extension/dist/cep/CSXS/manifest.xml`.
      - Icon gap **fixed** in Phase B: `cep.config.ts` now points at `./assets/*-icon.png` and
        `copyAssets: ["assets/light-icon.png", "assets/dark-icon.png"]` copies them into `dist/cep`.
- [x] **B. Flipped bridge** — panel `ws` server + `bridge.json` writer + state machine;
      `src/server/bridge.ts` is now a dial-in client with backoff and diagnosis codes.
      - **Server side:** `src/shared/protocol.ts` is protocol **v2** (server sends `hello`, panel
        answers `welcome`; calls carry `timeoutMs` + absolute `deadline`). `src/shared/paths.ts`
        owns `bridge.json` v2 and reports *why* a config is unusable (`ok|missing|legacy|malformed`)
        instead of returning `null`. `src/server/bridge.ts` is a non-blocking dial-in client
        (300 ms → 2 s backoff, connect/handshake deadlines, heartbeat, `AE_BUSY` on call timeout).
        `status` returns `{diagnosis, hint}`; `doctor` reports every hop.
      - **Panel side:** `extension/src/js/bridge/{types,config,host,server}.ts` — `PanelBridge`
        hosts `ws` on `127.0.0.1:47823` (falls back to an ephemeral port), publishes `bridge.json`
        atomically, authenticates `hello` against the shared token, serializes host calls through a
        queue with per-call deadlines, and exposes `status()` / `subscribe()` / `onLog()` to React.
        `src/jsx/aeft/aeft.ts` exposes `dispatch(tool, argsJson)`, which lazily `$.evalFile`s the
        legacy `host/offhand.jsx` until Phase D ports it; `vite.plugin.host.ts` copies `host/` into
        `dist/cep/host/` at build time.
      - **Verified:** extension build green (43 modules, `dist/cep/{assets,CSXS,host,jsx,main,
        node_modules/ws}`), root typecheck / 23 tests / lint / build green. Live check in AE 2023
        (23.6x62): the panel published `bridge.json` on `127.0.0.1:47823`, the MCP server connected
        (`state: ready`), and `status` returned real project data through the full chain
        MCP → WS → call queue → `evalTS` → legacy host. With AE closed the same tool returns
        `PANEL_NOT_RUNNING` plus the "open Window > Extensions > offhand" hint.
      - Gotcha found live: the panel publishes `startedAt` as **epoch ms (number)** while the server
        validated it as a string, which surfaced as `BRIDGE_STALE` / "missing required fields".
        The reader now accepts both; `tests/paths.test.ts` locks it in.
- [x] **C. React panel UI** — done. Beyond the minimal Phase B panel: persisted panel settings,
      a panel-owned **"Allow raw scripts"** gate on `execute`, richer AE/comp detail, and an empty
      state.
      - `extension/src/js/bridge/settings.ts` — `%APPDATA%\offhand\settings.json`
        (`{allowRawScripts:false}` by default), atomic tmp+rename write with Windows retries, and
        load-never-throws so a corrupt file cannot stop the bridge booting.
      - The gate lives in `PanelBridge.enqueueCall`: when `allowRawScripts` is false an `execute`
        call is answered immediately with code `EXECUTE_DISABLED` + a hint pointing at the toggle,
        and never reaches ExtendScript. Panel-owned on purpose — the MCP server can read the flag
        but never set it (a prompt-injected agent must not be able to unlock raw code).
      - Protocol: `welcome` now carries `settings`; toggling broadcasts
        `{type:"event", event:"settings"}`; `status` exposes `bridge.allowRawScripts`.
      - UI: switch in a **Permissions** card with a warning when enabled; AE card shows project
        path/dirty marker, comp size/fps/layers/playhead/duration, and "open a composition" empty
        state. System font stack only.
      - `tests/bridge.test.ts` covers the flag arriving in `welcome` and following an `event`.
      - Rebuild required for the panel to pick this up (`npm run build:extension`, then reload the
        panel from its flyout menu or restart AE).
- [x] **D. Host port** — `extension/host/**/*.jsx` → `extension/src/jsx/**/*.ts` with `evalTS`
      wiring; undo groups preserved. **Done (build green; live reload pending).**
      - `src/jsx/core/state.ts` is the shared mutable host namespace (`Offhand.tools`,
        `writeTools`, `json`, `util`). Every ported file imports it and registers into it, so the
        proven handler bodies moved over unchanged — the port is mechanical, not a rewrite.
      - Ported: `core/json.ts`, `core/util.ts`, and all 14 tools under `src/jsx/tools/`
        (`assets, comp, effect, execute, layer, mask, project, property, render, shape, status,
        text, view`).
      - `src/jsx/host.ts` is the single dispatcher: JSON args → handler → `{ok,data}` /
        `{ok:false,error}`, one `beginUndoGroup`/`endUndoGroup` around every write tool, and
        `INVALID_JSON` / `UNKNOWN_TOOL` / `HOST_ERROR` handling preserved from the ES3 original.
      - `src/jsx/aeft/aeft.ts` calls the bundled dispatcher; if a tool somehow reports
        `UNKNOWN_TOOL` it falls back to `dist/cep/host/offhand.jsx`, so a missed registration can
        never strand a call.
      - ES3 safety checked in the built `dist/cep/jsx/index.js` (~100 KB): no `=>`, `??`, `?.`,
        `let`/`const`; no ES5 builtins introduced by the new code (`map`/`forEach`/`Object.keys`/
        `Array.isArray`/`trim`). Babel + the ponyfill plugin emit ES3.
      - `tests/tools.test.ts`'s "matching `.jsx` exists" check still passes: the legacy
        `extension/host/` tree stays in the repo (not deleted) as the fallback, per the phase-A rule.
- [ ] **E. Tool surface** — layer IDs, write diffs, `batch`, `detail`, render jobs, execute promotion.
- [ ] **F. Testability** — fake panel, mock AE object model, eval task set.
- [ ] **G. Security/install** — `offhand install`, `offhand doctor --fix`, audit-log surfacing.
      (The raw-script toggle landed early, in Phase C.)
- [ ] **H. Docs + live AE verification** — README, `docs/*`, smoke test in AE 2023, then npm publish.

> **Phase D done 2026-11-25**: host ported into `src/jsx` (build green: 44 modules, jsx bundle
> ~100 KB, handlers verified present). Root `typecheck`, 24 tests, `lint` green. Live reload of the
> panel to exercise the new bundle still pending. Next up is Phase E (tool surface).
> Note: `offhand-mcp` is **not on npm** (`npm view` → 404), so MCP clients must launch
> `node D:/Projects/offhand/dist/cli.js` until Phase H publishes it. Restarting the client after a
> rebuild is required — an MCP server keeps running the code it was started with.

> **bolt-cep reference:** `https://github.com/hyperbrew/bolt-cep` (branch `master`).
> A shallow clone lives at `C:\Users\Muaj\AppData\Local\Temp\opencode\bolt-cep` while this work runs.
> Scaffold source of truth is `create-bolt-cep/src/index.ts`: it copies `*`, `src/**/*`, `.github/**/*`,
> renames `package.react.jsonc` → `package.json` and `tsconfig.react.json` → `tsconfig.json`, then
> swaps `com.bolt.cep` / `Bolt CEP` for your id / display name.

---

## Legacy: what's built & working (pre-rewrite)

### 1. What's Built & Working (Verified)

### Core MCP Server & Bridge (`src/`)
- **MCP Server (`src/server/server.ts`)**: Registers all 14 tools via `@modelcontextprotocol/sdk`, handles graceful shutdown, never writes to `stdout`.
- **WebSocket Bridge (`src/server/bridge.ts`)**: Server owns `ws://127.0.0.1:<port>`, CEP panel connects out as client. Token auth (`%APPDATA%\offhand\token`), config (`%APPDATA%\offhand\bridge.json`), 15s heartbeat, 45s stale timeout, hardened reconnect.
- **Error & Result Formatting (`src/shared/errors.ts`, `src/server/tools/result.ts`)**: `OffhandError` with `[CODE] message` + `Hint:` + optional `Details:`.
- **CLI & Diagnostics (`src/cli.ts`, `src/server/doctor.ts`, `src/server/log.ts`)**: `offhand`, `offhand doctor`, JSONL usage logging (`%APPDATA%\offhand\logs\usage.jsonl`).
- **Tests (`tests/`)**:
  - `tests/bridge.test.ts` (4 tests) — bridge handshake, calls, disconnect handling
  - `tests/docs.test.ts` (6 tests) — bundled AE docs search & lookup
  - `tests/tools.test.ts` (3 tests) — all 14 tools registered, matching `.jsx` files present, Zod schema validation
  - `tests/execute.test.ts` (4 tests) — unsafe ExtendScript sanitization (`system.callSystem`, `ExternalObject`, `Socket`, `BridgeTalk`, `.execute()`, `$.evalFile`, `eval`, `app.quit`, file writes)

### Bundled Docs (`src/server/data/ae-docs.ts`)
- Searchable reference for core AE scripting/expression APIs (`docs` tool works offline without AE).

### Brand & Design Assets (`assets/`)
- `icon-1024.png`, `logo-preview.png`, `FONT.md` (SpacePixi attribution) — committed.
- `logo.svg`, `logo-mark.svg`, `logo-light.svg`, `banner.svg` — present in `assets/` (currently untracked in git).

### Documentation
- `README.md`, `AGENT.md`, `DESIGN.md`, `docs/architecture.md`, `docs/tools.md`, `docs/security.md`, `docs/recipes.md`.

---

### 2. All 14 MCP Tools (Implemented, Needs Live AE Smoke Test)

Every tool has a TypeScript definition in `src/server/tools/<name>.ts` (registered in `src/server/tools/registry.ts`) and an ES3 ExtendScript handler in `extension/host/tools/<name>.jsx` (loaded in `extension/host/offhand.jsx`).

| Tool | Type | Actions / Purpose | Undo Group |
| --- | --- | --- | --- |
| `status` | Live | Bridge status, AE version, project, active comp, playhead, selection | No |
| `docs` | Live (offline) | `search`, `get` — bundled AE scripting & expression reference | No |
| `project` | Typed | `info`, `comps`, `items`, `open`, `save` | No |
| `comp` | Typed | `list`, `get`, `create`, `set` | Yes |
| `layer` | Typed | `list`, `get`, `create`, `set`, `duplicate`, `reorder`, `delete` | Yes |
| `property` | Typed | `list`, `get`, `set`, `keyframe`, `removeKeyframe`, `expression` | Yes |
| `effect` | Typed | `list`, `search`, `add`, `set`, `remove` | Yes |
| `text` | Typed | `get`, `create`, `set` (content, font, size, color, stroke, tracking, leading, justify) | Yes |
| `shape` | Typed | `get`, `create`, `set` (rect, ellipse, star, polygon, custom path, fill/stroke) | Yes |
| `mask` | Typed | `list`, `get`, `create`, `set`, `remove` (bounds, vertices, mode, feather, opacity, expansion) | Yes |
| `render` | Typed | `frame` (PNG preview), `queue`, `status`, `clear` | Yes |
| `assets` | Typed | `list`, `import`, `replace`, `folder`, `remove` | Yes |
| `view` | Typed | `open`, `time`, `select` | No |
| `execute` | Escape hatch | Raw ExtendScript with logged `reason` | Yes |

---

### 3. Legacy priorities (superseded by the rewrite plan above)

> These were the pre-rewrite goals. They are kept for reference; the rewrite phases A–H are the live plan.

#### Priority 1: Live After Effects Verification
1. Install CEP panel: `npm run install:cep`
2. Restart After Effects and open **Window → Extensions → offhand**.
3. Run `npm run doctor` to verify bridge connection.
4. Smoke-test each `.jsx` tool handler in AE (especially `comp`, `layer`, `property`, `effect`, `text`, `shape`, `mask`, `render.frame`, `assets`, `view`) to catch any ES3/AE-API quirks.

### Priority 2: Expand `src/server/data/ae-docs.ts`
Currently minimal. Add entries for:
- Keyframe easing (`KeyframeEase`, `setTemporalEaseAtKey`)
- Expressions (`wiggle`, `loopOut`, `time`, `thisComp`)
- Common effect match names
- Text, shape, and mask ExtendScript APIs

### Priority 3: CEP Panel UX (`extension/client/`)
- Add **"Copy MCP config"** button in `index.html` / `panel.js`.
- Add live usage log tail reading `%APPDATA%\offhand\logs\usage.jsonl`.
- Polish connected/disconnected indicator and auto-reconnect status.

### Priority 4: Package & Repo Cleanup
- Decide whether to commit or ignore the untracked `assets/*.svg` files.
- Verify `npm pack` contents (`dist`, `extension`, `assets`, `docs`, `README.md`, `LICENSE`).
- Publish to npm (`npm publish --access public`) when ready.
