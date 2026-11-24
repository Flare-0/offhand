# offhand Roadmap & Project Status

A clear breakdown of what is built, what is verified, and what still needs to be built or tested.

---

## Current State

- **Version:** `0.1.0`
- **Repository:** `D:\Projects\offhand` (`git@flare:Flare-0/offhand.git`, `main` branch)
- **Build & Checks:** `npm run typecheck`, `npm test` (3 files, 13 tests), `npm run lint`, and `npm run build` all pass.
- **Live After Effects Testing:** Not yet run against a live After Effects instance. TypeScript, Zod schemas, bridge tests, and docs tests are verified; ExtendScript (`.jsx`) handlers are written in ES3 and need live smoke-testing inside AE.

---

## 1. What's Built & Working (Verified)

### Core MCP Server & Bridge (`src/`)
- **MCP Server (`src/server/server.ts`)**: Registers all 14 tools via `@modelcontextprotocol/sdk`, handles graceful shutdown, never writes to `stdout`.
- **WebSocket Bridge (`src/server/bridge.ts`)**: Server owns `ws://127.0.0.1:<port>`, CEP panel connects out as client. Token auth (`%APPDATA%\offhand\token`), config (`%APPDATA%\offhand\bridge.json`), 15s heartbeat, 45s stale timeout, hardened reconnect.
- **Error & Result Formatting (`src/shared/errors.ts`, `src/server/tools/result.ts`)**: `OffhandError` with `[CODE] message` + `Hint:` + optional `Details:`.
- **CLI & Diagnostics (`src/cli.ts`, `src/server/doctor.ts`, `src/server/log.ts`)**: `offhand`, `offhand doctor`, JSONL usage logging (`%APPDATA%\offhand\logs\usage.jsonl`).
- **Tests (`tests/`)**:
  - `tests/bridge.test.ts` (4 tests) — bridge handshake, calls, disconnect handling
  - `tests/docs.test.ts` (6 tests) — bundled AE docs search & lookup
  - `tests/tools.test.ts` (3 tests) — all 14 tools registered, matching `.jsx` files present, Zod schema validation

### Bundled Docs (`src/server/data/ae-docs.ts`)
- Searchable reference for core AE scripting/expression APIs (`docs` tool works offline without AE).

### Brand & Design Assets (`assets/`)
- `icon-1024.png`, `logo-preview.png`, `FONT.md` (SpacePixi attribution) — committed.
- `logo.svg`, `logo-mark.svg`, `logo-light.svg`, `banner.svg` — present in `assets/` (currently untracked in git).

### Documentation
- `README.md`, `AGENT.md`, `DESIGN.md`, `docs/architecture.md`, `docs/tools.md`, `docs/security.md`, `docs/recipes.md`.

---

## 2. All 14 MCP Tools (Implemented, Needs Live AE Smoke Test)

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

## 3. What Still Needs to Be Built / Done

### Priority 1: Live After Effects Verification
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
