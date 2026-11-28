// Panel-side bridge configuration: where bridge.json lives, how the token is
// created, and how the file is published atomically.
//
// The MCP server reads the same file with plain Node `fs`. Nothing here uses
// `cep.fs` — that was the original bug: a silent `null` turned into a panel
// stuck on "Waiting for server" with no error to show.

import { crypto, fs, os, path } from "../lib/cep/node";
import type { BridgeConfig } from "./types";
import { PANEL_PROTOCOL_VERSION } from "./types";

export const BRIDGE_CONFIG_VERSION = 2 as const;
export const BRIDGE_HOST = "127.0.0.1";
export const PREFERRED_PORT = 47823;
// Keep in sync with extension/package.json (tests/versions.test.ts enforces it).
export const PANEL_VERSION = "0.2.0";

const TOKEN_PATTERN = /^[a-f0-9]{48}$/;

/** True when the panel has a real Node runtime (`--enable-nodejs`). */
export const nodeAvailable = (): boolean =>
  typeof window !== "undefined" && Boolean(window.cep_node);

const requireNode = (): void => {
  if (!nodeAvailable()) {
    throw new Error(
      "offhand: the panel has no Node runtime. Add --enable-nodejs to the " +
        "CEP parameters and restart After Effects.",
    );
  }
};

const env = (): Record<string, string | undefined> => {
  try {
    return (window.cep_node.process.env ?? {}) as Record<string, string | undefined>;
  } catch {
    return {};
  }
};

const platform = (): string => {
  try {
    return String(window.cep_node.process.platform ?? "");
  } catch {
    return "";
  }
};

export const appDataDir = (): string => {
  requireNode();
  const override = env().OFFHAND_HOME;
  if (override) return override;

  if (platform() === "win32") {
    const base =
      env().APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "offhand");
  }
  if (platform() === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "offhand");
  }
  const base = env().XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "offhand");
};

export const bridgeConfigPath = (): string =>
  path.join(appDataDir(), "bridge.json");

export const tokenPath = (): string => path.join(appDataDir(), "token");

export const ensureAppDirs = (): void => {
  fs.mkdirSync(appDataDir(), { recursive: true });
};

const isToken = (value: string): boolean => TOKEN_PATTERN.test(value.trim());

/**
 * Returns the shared token, creating it once. Safe against two panel instances
 * starting at the same time: creation uses `flag: "wx"`, and the loser re-reads
 * the winner's token instead of overwriting it.
 */
export const getOrCreateToken = (): string => {
  requireNode();
  ensureAppDirs();
  const file = tokenPath();

  if (fs.existsSync(file)) {
    const existing = String(fs.readFileSync(file, "utf8")).trim();
    if (isToken(existing)) return existing;
  }

  const token = crypto.randomBytes(24).toString("hex");
  try {
    fs.writeFileSync(file, token + "\n", { encoding: "utf8", flag: "wx" });
    return token;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "EEXIST") throw error;
    const existing = String(fs.readFileSync(file, "utf8")).trim();
    if (!isToken(existing)) {
      throw new Error(
        `offhand: ${file} exists but does not contain a valid token.`,
      );
    }
    return existing;
  }
};

const sleep = (ms: number): void => {
  // Panel main thread only — short spins, only while retrying a rename that
  // Windows briefly locks when a reader (the MCP server) has the file open.
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Busy-wait: Atomics is unavailable in the CEP renderer.
  }
};

/**
 * Writes bridge.json via write-temp-then-rename so a reader never observes a
 * half-written file. Windows can reject the rename with EPERM/EBUSY/EACCES for
 * a few ms when the file is open elsewhere, so retry briefly.
 */
export const writeBridgeConfig = (config: BridgeConfig): void => {
  requireNode();
  ensureAppDirs();
  const target = bridgeConfigPath();
  const tmp = `${target}.${processId()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string })?.code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      sleep(25 * (attempt + 1));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("offhand: could not publish bridge.json");
};

export const processId = (): number => {
  try {
    return Number(window.cep_node.process.pid ?? 0);
  } catch {
    return 0;
  }
};

export const buildBridgeConfig = (
  port: number,
  token: string,
  startedAt: number,
): BridgeConfig => ({
  version: BRIDGE_CONFIG_VERSION,
  protocol: PANEL_PROTOCOL_VERSION,
  host: BRIDGE_HOST,
  port,
  token,
  pid: processId(),
  panelVersion: PANEL_VERSION,
  startedAt,
});
