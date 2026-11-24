# Recipes

These are the intended agent workflows. Recipes marked **planned** depend on tools that are not
implemented yet; the live `status`, `docs`, and `execute` tools work today.

## Inspect before writing

Always start with state, not assumptions.

```text
status
```

If the active comp is wrong, list comps and pass one explicitly. If a layer name is uncertain, list
layers. After a structural change, re-read the comp instead of reusing old indices.

## Find the right API

Use `docs` before `execute`.

```text
docs { "action": "search", "query": "save frame png" }
docs { "action": "get", "id": "comp.saveFrameToPng" }
```

The reference is small and curated. It covers the objects most agent tasks need: comps, layers,
properties, keyframes, expressions, text, shapes, masks, render queue, and footage.

## Create a title card — planned

```text
comp { "action": "create", "name": "Title", "width": 1920, "height": 1080, "fps": 30, "duration": 5 }
layer { "action": "create", "comp": "Title", "type": "text", "name": "Headline" }
text {
  "action": "set",
  "comp": "Title",
  "layer": "Headline",
  "text": "After Effects, at hand.",
  "font": "Arial-BoldMT",
  "size": 96,
  "color": "#fedefe"
}
property { "action": "set", "comp": "Title", "layer": "Headline", "path": "transform.position", "value": [960, 540] }
```

## Animate a property — planned

```text
property { "action": "keyframe", "comp": "Main", "layer": "Title", "path": "transform.opacity", "time": 0, "value": 0 }
property { "action": "keyframe", "comp": "Main", "layer": "Title", "path": "transform.opacity", "time": 0.6, "value": 100 }
property { "action": "keyframe", "comp": "Main", "layer": "Title", "path": "transform.opacity", "time": 4.4, "value": 100 }
property { "action": "keyframe", "comp": "Main", "layer": "Title", "path": "transform.opacity", "time": 5, "value": 0 }
```

## Add a glow — planned

```text
effect { "action": "search", "query": "glow" }
effect { "action": "add", "comp": "Main", "layer": "Title", "effect": "ADBE Glo2" }
effect { "action": "set", "comp": "Main", "layer": "Title", "effect": "Glow", "property": "Glow Threshold", "value": 0.4 }
```

## Preview one frame — planned

```text
render { "action": "frame", "comp": "Main", "time": 2.0, "path": "C:/work/preview.png" }
```

`comp.saveFrameToPng` is much faster than a queued render because it skips the render queue. Use it
for visual verification; reserve the queue for final output.

## Use `execute` correctly

`execute` is for work that has no typed tool yet. Keep it narrow, return a small value, and state the
reason.

```text
docs { "action": "search", "query": "work area" }
execute {
  "script": "var c = app.project.activeItem; ({ name: c.name, workAreaStart: c.workAreaStart, workAreaDuration: c.workAreaDuration })",
  "reason": "No typed comp tool yet; reading work-area fields."
}
```

Do not use `execute` to batch a workflow that typed tools already cover. That hides errors and makes
the operation harder to audit.

## Recover from a disconnect

If a call returns `BRIDGE_OFFLINE`:

1. Check that After Effects is running.
2. Open **Window → Extensions → offhand**.
3. Run `status` again.

If it returns `BRIDGE_TIMEOUT`, the operation may still be running. Check After Effects before
retrying, especially for renders.
