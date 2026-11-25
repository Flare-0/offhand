// Panel-side settings, persisted next to bridge.json.
//
// Settings are deliberately panel-owned: the MCP server can *read* them (they
// ride along in the welcome message and in `settings` events) but can never
// turn them on. Otherwise a prompt-injected agent could enable raw ExtendScript
// and then run arbitrary code in After Effects.

import { fs, path } from "../lib/cep/node";
import { appDataDir, ensureAppDirs, processId } from "./config";
import type { PanelSettings } from "./types";

export const DEFAULT_SETTINGS: PanelSettings = {
  // Raw ExtendScript is a break-glass tool, not the default. The typed tools
  // cover the normal path; `execute` is for gaps that get promoted later.
  allowRawScripts: false,
};

export const settingsPath = (): string => path.join(appDataDir(), "settings.json");

const sanitize = (value: unknown): PanelSettings => {
  const source = (value ?? {}) as Partial<PanelSettings>;
  return {
    allowRawScripts:
      typeof source.allowRawScripts === "boolean"
        ? source.allowRawScripts
        : DEFAULT_SETTINGS.allowRawScripts,
  };
};

/** Never throws: a corrupt settings file must not stop the bridge from booting. */
export const loadSettings = (): PanelSettings => {
  try {
    const file = settingsPath();
    if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(String(fs.readFileSync(file, "utf8"))));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

/**
 * Writes settings.json atomically. Mirrors bridge.json: temp file plus rename,
 * with a few short retries because Windows can briefly lock the target.
 */
export const saveSettings = (settings: PanelSettings): PanelSettings => {
  const next = sanitize(settings);
  ensureAppDirs();
  const target = settingsPath();
  const tmp = `${target}.${processId()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.renameSync(tmp, target);
      return next;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      // Panel main thread only, and only for a few milliseconds.
      const until = Date.now() + 25 * (attempt + 1);
      while (Date.now() < until) {
        // Busy-wait: Atomics is unavailable in the CEP renderer.
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("offhand: could not write settings.json");
};
