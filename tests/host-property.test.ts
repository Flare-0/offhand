import { beforeEach, describe, expect, it } from "vitest";
import { installAeMock } from "./support/ae-mock";
import { dispatch } from "../extension/src/jsx/host";
import { Offhand } from "../extension/src/jsx/core/state";

const ae = installAeMock();

function run(tool: string, args: Record<string, unknown>): any {
  return JSON.parse(dispatch(tool, JSON.stringify(args)));
}

function position(): any {
  return ae.layer.property("ADBE Transform Group")!.property("ADBE Position")!;
}

beforeEach(() => {
  ae.reset();
  Offhand.jobs = [];
  ae.comp.openInViewer();
  ae.layer.selected = true;
});

describe("property set", () => {
  it("pads a 2-component position to 3 components", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [100, 100],
    });
    expect(result.ok).toBe(true);
    expect(position().value).toEqual([100, 100, 0]);
    expect(result.data.changed.value.from).toEqual([960, 540, 0]);
    expect(result.data.changed.value.to).toEqual([100, 100, 0]);
  });

  it("keeps the existing z when padding", () => {
    position().setValue([10, 20, 30]);
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [40, 50],
    });
    expect(result.ok).toBe(true);
    expect(position().value).toEqual([40, 50, 30]);
  });

  it("accepts numeric strings and pads them", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: ["88", "99"],
    });
    expect(result.ok).toBe(true);
    expect(position().value).toEqual([88, 99, 0]);
  });

  it("accepts a full 3-component vector", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [1, 2, 3],
    });
    expect(result.ok).toBe(true);
    expect(position().value).toEqual([1, 2, 3]);
  });

  it("rejects a single component for a 3D property", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [5],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_ARGS");
    expect(result.error.message).toContain("3 numbers");
  });

  it("sets a scalar property", () => {
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.opacity",
      value: 40,
    });
    expect(result.ok).toBe(true);
    expect(ae.layer.property("ADBE Transform Group")!.property("ADBE Opacity")!.value).toBe(40);
  });

  it("creates a keyframe from a 2-component value", () => {
    const result = run("property", {
      action: "keyframe",
      layer: "Solid 1",
      path: "transform.position",
      time: 1,
      value: [50, 60],
    });
    expect(result.ok).toBe(true);
    expect(position().numKeys).toBe(1);
    expect(position().keyValue(1)).toEqual([50, 60, 0]);
  });

  it("fails loudly instead of reporting a no-op write", () => {
    const prop: any = position();
    let written: any = null;
    prop.setValue = (value: any) => {
      written = value;
    };
    const result = run("property", {
      action: "set",
      layer: "Solid 1",
      path: "transform.position",
      value: [7, 8],
    });
    expect(written).toEqual([7, 8, 0]);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_STATE");
  });
});
