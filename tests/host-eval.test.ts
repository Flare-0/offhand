import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAeMock } from "./support/ae-mock";
import { dispatch } from "../extension/src/jsx/host";
import { Offhand } from "../extension/src/jsx/core/state";

const ae = installAeMock();

function run(tool: string, args: Record<string, unknown>): any {
  return JSON.parse(dispatch(tool, JSON.stringify(args)));
}

function work(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "offhand-eval-")), name).replace(/\\/g, "/");
}

beforeEach(() => {
  ae.reset();
  Offhand.jobs = [];
});

describe("comp", () => {
  it("lists the active comp", () => {
    const result = run("comp", { action: "list" });
    expect(result.ok).toBe(true);
    expect(result.data.items[0].name).toBe("Main");
  });

  it("creates and reads a comp", () => {
    const created = run("comp", {
      action: "create",
      name: "Intro",
      width: 1280,
      height: 720,
      fps: 24,
      duration: 5,
    });
    expect(created.ok).toBe(true);
    expect(created.data.created.name).toBe("Intro");
    const got = run("comp", { action: "get", comp: "Intro" });
    expect(got.data.width).toBe(1280);
    expect(got.data.fps).toBe(24);
    expect(got.data.duration).toBe(5);
  });

  it("updates settings and reports changes", () => {
    const result = run("comp", {
      action: "set",
      comp: "Main",
      width: 640,
      height: 480,
      fps: 12,
      duration: 3,
    });
    expect(result.ok).toBe(true);
    expect(result.data.width).toBe(640);
    expect(result.data.fps).toBe(12);
    expect(result.data.changed.fps.from).toBe(30);
  });

  it("rejects invalid fps", () => {
    const result = run("comp", { action: "create", name: "Bad", fps: 0 });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_ARGS");
  });
});

describe("layer", () => {
  it("lists layers", () => {
    const result = run("layer", { action: "list" });
    expect(result.ok).toBe(true);
    expect(result.data.items[0].name).toBe("Solid 1");
  });

  it("creates a solid and reads its transform", () => {
    const created = run("layer", {
      action: "create",
      type: "solid",
      name: "Box",
      color: [1, 0, 0],
      width: 200,
      height: 100,
    });
    expect(created.ok).toBe(true);
    expect(created.data.created.name).toBe("Box");
    const got = run("layer", { action: "get", layer: "Box" });
    expect(got.data.transform.position).toEqual([960, 540, 0]);
  });

  it("creates text and shape layers", () => {
    const text = run("layer", { action: "create", type: "text", text: "Hi" });
    expect(text.ok).toBe(true);
    expect(text.data.created.type).toBe("text");
    const shape = run("layer", { action: "create", type: "shape" });
    expect(shape.ok).toBe(true);
    expect(shape.data.created.type).toBe("shape");
  });

  it("renames a layer", () => {
    const result = run("layer", { action: "set", layer: "Solid 1", name: "Background" });
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe("Background");
    expect(result.data.changed.name.from).toBe("Solid 1");
  });

  it("duplicates a layer", () => {
    const result = run("layer", { action: "duplicate", layer: "Solid 1" });
    expect(result.ok).toBe(true);
    expect(result.data.created.name).toContain("Solid 1");
    expect(result.data.created.uid).toMatch(/^L\d+$/);
    expect(result.data.changed.duplicateOf.from).toMatch(/^L\d+$/);
    expect(run("layer", { action: "list" }).data.total).toBe(2);
  });

  it("reorders a layer", () => {
    run("layer", { action: "create", type: "solid", name: "Top" });
    const before = run("layer", { action: "list" }).data.items as Array<{ uid: string; name: string }>;
    const topUid = before.find((item) => item.name === "Top")?.uid;
    const solidUid = before.find((item) => item.name === "Solid 1")?.uid;
    const result = run("layer", { action: "reorder", layer: "Top", after: "Solid 1" });
    expect(result.ok).toBe(true);
    expect(result.data.uid).toBe(topUid);
    expect(result.data.changed.neighbors.to.above).toBe(solidUid);
    expect(run("layer", { action: "list" }).data.items[1].name).toBe("Top");
  });

  it("exposes a stable uid and no layer index", () => {
    const item = run("layer", { action: "list" }).data.items[0];
    expect(item.uid).toMatch(/^L\d+$/);
    expect(item).not.toHaveProperty("index");
    expect(item).not.toHaveProperty("id");
    const got = run("layer", { action: "get", layer: item.uid });
    expect(got.ok).toBe(true);
    expect(got.data.uid).toBe(item.uid);
  });

  it("resolves uid prefixes and never treats a numeric string as an index", () => {
    const created = run("layer", { action: "create", type: "solid", name: "Top" });
    const uid = created.data.uid as string;
    const id = uid.slice(1);
    expect(run("layer", { action: "get", layer: `#${id}` }).data.uid).toBe(uid);
    expect(run("layer", { action: "get", layer: `id:${id}` }).data.uid).toBe(uid);
    expect(run("layer", { action: "get", layer: `uid:${id}` }).data.uid).toBe(uid);
    expect(run("layer", { action: "get", layer: Number(id) }).data.uid).toBe(uid);
    expect(run("layer", { action: "get", layer: id }).data.uid).toBe(uid);
    const numericString = run("layer", { action: "get", layer: "1" });
    expect(numericString.ok).toBe(false);
    expect(numericString.error.code).toBe("NOT_FOUND");
  });

  it("sets and clears a parent by uid", () => {
    const child = run("layer", { action: "create", type: "solid", name: "Child" });
    const parent = run("layer", { action: "create", type: "null", name: "Ctrl" });
    const parentUid = parent.data.uid as string;
    const set = run("layer", { action: "set", layer: child.data.uid, parent: parentUid });
    expect(set.ok).toBe(true);
    expect(set.data.changed.parent.to).toBe(parentUid);
    expect(run("layer", { action: "get", layer: child.data.uid }).data.parentUid).toBe(parentUid);
    const cleared = run("layer", { action: "set", layer: child.data.uid, parent: null });
    expect(cleared.data.parentUid).toBe(null);
  });

  it("requires confirm to delete", () => {
    const refused = run("layer", { action: "delete", layer: "Solid 1" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_ARGS");
    const deleted = run("layer", { action: "delete", layer: "Solid 1", confirm: true });
    expect(deleted.ok).toBe(true);
    expect(deleted.data.removed.uid).toMatch(/^L\d+$/);
    expect(run("layer", { action: "list" }).data.total).toBe(0);
  });

  it("reports unknown layers", () => {
    const result = run("layer", { action: "get", layer: "Nope" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("text", () => {
  it("creates and edits text", () => {
    const created = run("text", { action: "create", text: "Hello", name: "Title" });
    expect(created.ok).toBe(true);
    expect(created.data.created.name).toBe("Title");
    const edited = run("text", {
      action: "set",
      layer: "Title",
      text: "Hello world",
      size: 72,
    });
    expect(edited.ok).toBe(true);
    expect(edited.data.text).toBe("Hello world");
    expect(edited.data.size).toBe(72);
    expect(edited.data.changed.text.to).toBe("Hello world");
  });

  it("refuses a non-text layer", () => {
    const result = run("text", { action: "get", layer: "Solid 1" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_ARGS");
  });
});

describe("shape", () => {
  it("creates a shape and reads its geometry", () => {
    const created = run("shape", {
      action: "create",
      shape: "rect",
      name: "Card",
      size: [300, 200],
      color: [0, 0.5, 1],
    });
    expect(created.ok).toBe(true);
    expect(created.data.created.name).toBe("Card");
    const got = run("shape", { action: "get", layer: "Card" });
    expect(got.data.shape).toBe("rect");
    expect(got.data.size).toEqual([300, 200]);
  });

  it("updates size and fill", () => {
    run("shape", { action: "create", shape: "ellipse", name: "Dot", size: [50, 50] });
    const result = run("shape", {
      action: "set",
      layer: "Dot",
      size: [80, 80],
      color: [1, 1, 0],
    });
    expect(result.ok).toBe(true);
    expect(result.data.size).toEqual([80, 80]);
    expect(result.data.changed.size.to).toEqual([80, 80]);
  });
});

describe("effect", () => {
  it("searches installed effects", () => {
    const result = run("effect", { action: "search", query: "glow" });
    expect(result.ok).toBe(true);
    expect(result.data.items.some((item: any) => item.matchName === "ADBE Glo2")).toBe(true);
  });

  it("adds, lists, and configures an effect", () => {
    const added = run("effect", { action: "add", layer: "Solid 1", effect: "Glow" });
    expect(added.ok).toBe(true);
    expect(added.data.created.matchName).toBe("ADBE Glo2");
    const listed = run("effect", { action: "list", layer: "Solid 1" });
    expect(listed.data.total).toBe(1);
    const set = run("effect", {
      action: "set",
      layer: "Solid 1",
      effect: "Glow",
      property: "Glow Radius",
      value: 25,
    });
    expect(set.ok).toBe(true);
    expect(set.data.changed["Glow Radius"].to).toBe(25);
  });

  it("requires confirm to remove an effect", () => {
    run("effect", { action: "add", layer: "Solid 1", effect: "Glow" });
    const refused = run("effect", { action: "remove", layer: "Solid 1", effect: "Glow" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_ARGS");
    const removed = run("effect", {
      action: "remove",
      layer: "Solid 1",
      effect: "Glow",
      confirm: true,
    });
    expect(removed.ok).toBe(true);
  });
});

describe("mask", () => {
  it("creates, lists, edits, and removes a mask", () => {
    const created = run("mask", {
      action: "create",
      layer: "Solid 1",
      name: "Cutout",
      bounds: [100, 100, 300, 300],
    });
    expect(created.ok).toBe(true);
    expect(created.data.created.name).toBe("Cutout");

    const listed = run("mask", { action: "list", layer: "Solid 1" });
    expect(listed.data.total).toBe(1);
    expect(typeof listed.data.items[0].mode).toBe("number");

    const set = run("mask", { action: "set", layer: "Solid 1", mask: "Cutout", feather: [12, 12] });
    expect(set.ok).toBe(true);
    expect(set.data.feather).toEqual([12, 12]);

    const refused = run("mask", { action: "remove", layer: "Solid 1", mask: "Cutout" });
    expect(refused.error.code).toBe("INVALID_ARGS");
    const removed = run("mask", {
      action: "remove",
      layer: "Solid 1",
      mask: "Cutout",
      confirm: true,
    });
    expect(removed.ok).toBe(true);
    expect(run("mask", { action: "list", layer: "Solid 1" }).data.total).toBe(0);
  });
});

describe("render", () => {
  it("saves a frame", () => {
    const path = work("frame.png");
    const result = run("render", { action: "frame", time: 1, path });
    expect(result.ok).toBe(true);
    expect(result.data.saved).toBe(true);
  });

  it("auto-applies H.264 for mp4 output", () => {
    const result = run("render", { action: "queue", comp: "Main", output: work("main.mp4") });
    expect(result.ok).toBe(true);
    expect(result.data.outputModule).toContain("H.264");
    expect(result.data.items[0].statusName).toBe("QUEUED");
  });

  it("honours an explicit output module", () => {
    const result = run("render", {
      action: "queue",
      comp: "Main",
      output: work("main.avi"),
      outputModule: "Lossless",
    });
    expect(result.ok).toBe(true);
    expect(result.data.outputModule).toBe("Lossless");
  });

  it("renders queued items and reports done", () => {
    run("render", { action: "queue", comp: "Main", output: work("main.mp4") });
    const started = run("render", { action: "start" });
    expect(started.ok).toBe(true);
    expect(started.data.started).toBe(true);
    expect(started.data.scheduled).toBe(true);
    expect(started.data.blocking).toBe(false);
    ae.runScheduled();
    const status = run("render", { action: "status" });
    expect(status.data.items[0].statusName).toBe("DONE");
    expect(status.data.items[0].state).toBe("done");
  });

  it("starts queued items after the panel loses its job memory", () => {
    run("render", { action: "queue", comp: "Main", output: work("main.mp4") });
    Offhand.jobs = [];
    const started = run("render", { action: "start" });
    expect(started.ok).toBe(true);
    expect(started.data.scheduled).toBe(true);
    expect(started.data.jobs).toHaveLength(1);
    ae.runScheduled();
    expect(run("render", { action: "status" }).data.items[0].statusName).toBe("DONE");
  });

  it("schedules queue start without blocking", () => {
    const queued = run("render", { action: "queue", comp: "Main", output: work("main.mp4"), start: true });
    expect(queued.ok).toBe(true);
    expect(queued.data.scheduled).toBe(true);
    expect(queued.data.blocking).toBe(false);
    expect(queued.data.job.status).toBe("rendering");
    ae.runScheduled();
    expect(run("render", { action: "jobs" }).data.jobs[0].status).toBe("done");
  });

  it("refuses to clear while rendering", () => {
    run("render", { action: "queue", comp: "Main", output: work("main.mp4") });
    ae.renderQueue.rendering = true;
    const refused = run("render", { action: "clear", confirm: true });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_STATE");
  });

  it("requires confirm to clear the queue", () => {
    run("render", { action: "queue", comp: "Main", output: work("main.mp4") });
    const refused = run("render", { action: "clear" });
    expect(refused.error.code).toBe("INVALID_ARGS");
    const cleared = run("render", { action: "clear", confirm: true });
    expect(cleared.ok).toBe(true);
    expect(run("render", { action: "status" }).data.total).toBe(0);
  });
});

describe("view, status, project", () => {
  it("moves the playhead", () => {
    const result = run("view", { action: "time", time: 2 });
    expect(result.ok).toBe(true);
    expect(result.data.time).toBe(2);
  });

  it("selects a layer", () => {
    const result = run("view", { action: "select", layer: "Solid 1" });
    expect(result.ok).toBe(true);
    expect(result.data.selected[0].name).toBe("Solid 1");
    expect(result.data.selected[0].uid).toMatch(/^L\d+$/);
  });

  it("opens a comp in the viewer", () => {
    const result = run("view", { action: "open", comp: "Main" });
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe("Main");
  });

  it("saves and opens a project file", () => {
    const untitled = run("project", { action: "save" });
    expect(untitled.ok).toBe(false);
    expect(untitled.error.code).toBe("INVALID_ARGS");
    const savePath = work("project.aep");
    const saved = run("project", { action: "save", path: savePath });
    expect(saved.ok).toBe(true);
    expect(saved.data.saved).toBe(true);
    const missing = run("project", { action: "open", path: work("missing.aep") });
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("reports bridge status", () => {
    const result = run("status", {});
    expect(result.ok).toBe(true);
    expect(result.data.project.name).toBe("Untitled");
    expect(result.data.comp.name).toBe("Main");
    expect(result.data.selection.layers[0].name).toBe("Solid 1");
  });

  it("reports project info and comps", () => {
    const info = run("project", { action: "info" });
    expect(info.data.comps).toBe(1);
    const comps = run("project", { action: "comps" });
    expect(comps.data.items[0].name).toBe("Main");
  });
});

describe("property", () => {
  it("sets a 2-number position", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [100, 100],
    });
    if (!result.ok) console.log("POSITION SET", JSON.stringify(result));
    expect(result.ok).toBe(true);
    expect(run("layer", { action: "get", layer: "Solid 1" }).data.transform.position).toEqual([
      100, 100, 0,
    ]);
  });

  it("verifies the write actually landed", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [10, 20, 0],
    });
    expect(result.data.changed.value.to).toEqual([10, 20, 0]);
  });
});

describe("batch", () => {
  it("runs several calls in order", () => {
    const result = run("batch", {
      calls: [
        { tool: "comp", args: { action: "list" } },
        { tool: "status", args: {} },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.data.ran).toBe(2);
    expect(result.data.failed).toBe(0);
    expect(result.data.results[0].ok).toBe(true);
  });

  it("stops at the first failure by default", () => {
    const result = run("batch", {
      calls: [
        { tool: "comp", args: { action: "nope" } },
        { tool: "status", args: {} },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.data.stoppedEarly).toBe(true);
    expect(result.data.ran).toBe(1);
    expect(result.data.results[0].ok).toBe(false);
  });

  it("continues when stopOnError is false", () => {
    const result = run("batch", {
      stopOnError: false,
      calls: [
        { tool: "comp", args: { action: "nope" } },
        { tool: "status", args: {} },
      ],
    });
    expect(result.data.ran).toBe(2);
    expect(result.data.failed).toBe(1);
  });

  it("rejects unknown tools", () => {
    const result = run("batch", { calls: [{ tool: "nope", args: {} }] });
    expect(result.data.results[0].error.code).toBe("UNKNOWN_TOOL");
  });
});
