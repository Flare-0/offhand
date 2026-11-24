# Tools

The server exposes a small surface. Every tool is designed for an agent, not as a one-to-one wrapper
around the After Effects API.

## Conventions

- **Read tools** default to a small result set and include a `limit`.
- **Write tools** state that they mutate the project and run in one undo group.
- **Errors** return `isError: true` with `[CODE] message` and a `Hint:` line.
- **Ids** are numeric After Effects ids where the API provides them; names are accepted for
  convenience.
- **Times** are seconds unless a field says frames.
- **Colors** accept `"#rrggbb"` or `[r, g, b]` in 0–255 or 0–1.

## Live tools

### `status`

Checks the bridge and reads the current After Effects state.

Input: none.

Returns:

```json
{
  "connected": true,
  "bridge": { "panelVersion": "0.1.0", "connectedAt": "…" },
  "afterEffects": {
    "version": "23.6.0",
    "project": { "name": "Untitled", "path": null, "dirty": false, "items": 4 },
    "comp": {
      "id": 3,
      "name": "Main",
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "duration": 10,
      "time": 1.5,
      "layers": 6
    },
    "selection": { "items": [], "layers": [{ "index": 2, "name": "Title" }] }
  }
}
```

If the panel is not connected, returns `connected: false` plus a hint instead of an error.

### `docs`

Searches the bundled After Effects scripting and expression reference.

```json
{ "action": "search", "query": "save frame png", "limit": 5 }
```

```json
{ "action": "get", "id": "comp.saveFrameToPng" }
```

Search returns compact matches with `id`, `title`, `kind`, `signature`, `summary`, and `url`. `get`
returns the full entry. Use this before `execute`, or when an API name is uncertain.

### `execute`

Runs raw ExtendScript. Last resort.

```json
{
  "script": "app.project.activeItem.time",
  "reason": "No typed tool exposes the current comp time yet.",
  "timeout_ms": 30000
}
```

Notes:

- The script runs on the ExtendScript main thread and blocks the AE UI.
- The dispatcher opens an undo group around the script.
- The reason is written to the usage log.
- `result` is JSON-serialized; cycles become `"<cycle>"`.
- Use `execute` to discover a missing tool, then open an issue or add the typed tool.

## Typed tools

All typed tools are live and map directly to handlers in `extension/host/tools/`. Write tools
automatically run inside one After Effects undo group.

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
{
  "action": "create",
  "comp": "Main",
  "text": "After Effects, at hand.",
  "font": "Arial-BoldMT",
  "size": 96,
  "color": "#fedefe",
  "position": [960, 540]
}
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

## Error contract

Tool execution failures return:

```
[NOT_FOUND] No composition named "Main".
Hint: Call project with action="comps" to list compositions.
```

The code is stable; the message and hint are for the agent. Protocol errors (unknown tool, malformed
JSON-RPC) are handled by the MCP SDK and never reach a tool handler.
