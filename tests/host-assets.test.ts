import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAeMock } from "./support/ae-mock";
import { dispatch } from "../extension/src/jsx/host";
import { Offhand } from "../extension/src/jsx/core/state";

const ae = installAeMock();

function run(tool: string, args: Record<string, unknown>): any {
  return JSON.parse(dispatch(tool, JSON.stringify(args)));
}

/** Writes a stand-in media file so `File.exists` sees it. */
function media(name = "tile.png"): string {
  const dir = mkdtempSync(join(tmpdir(), "offhand-assets-"));
  const file = join(dir, name);
  writeFileSync(file, "png");
  return file.replace(/\\/g, "/");
}

beforeEach(() => {
  ae.reset();
  Offhand.jobs = [];
});

describe("assets import", () => {
  it("imports one file passed as path", () => {
    const path = media("single.png");
    const result = run("assets", { action: "import", path });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.imported[0].name).toBe("single.png");
    expect(result.data.imported[0].type).toBe("footage");
    expect(result.data.imported[0].path).toBe(path);
  });

  it("imports one file passed as a paths array", () => {
    const path = media("array.png");
    const result = run("assets", { action: "import", paths: [path] });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
  });

  it("imports one file passed as a paths string", () => {
    const path = media("string.png");
    const result = run("assets", { action: "import", paths: path });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
  });

  it("falls back to path when paths is empty", () => {
    const path = media("fallback.png");
    const result = run("assets", { action: "import", paths: [], path });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
  });

  it("requires a path", () => {
    const result = run("assets", { action: "import" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_ARGS");
    expect(result.error.message).toContain("path");
  });

  it("reports a missing file", () => {
    const result = run("assets", { action: "import", path: "C:/definitely/missing.png" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("imports into a folder", () => {
    const folder = run("assets", { action: "folder", name: "Footage" });
    expect(folder.ok).toBe(true);
    const path = media("foldered.png");
    const result = run("assets", { action: "import", path, folder: "Footage" });
    expect(result.ok).toBe(true);
    const after = run("assets", { action: "list" });
    const imported = after.data.items.find((item: any) => item.name === "foldered.png");
    expect(imported.parent).toBe("Footage");
  });

  it("replaces footage", () => {
    const first = media("first.png");
    const second = media("second.png");
    const imported = run("assets", { action: "import", path: first });
    const id = imported.data.imported[0].id;
    const replaced = run("assets", { action: "replace", item: id, path: second });
    expect(replaced.ok).toBe(true);
    expect(replaced.data.path).toBe(second);
  });
});
