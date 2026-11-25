import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Version 2 of bridge.json. The **panel** owns this file now: it listens, then
 * publishes its address here. The MCP server only ever reads it.
 */
export const BRIDGE_CONFIG_VERSION = 2;

export interface BridgeConfig {
  version: typeof BRIDGE_CONFIG_VERSION;
  protocol: number;
  host: string;
  port: number;
  token: string;
  pid: number;
  panelVersion: string;
  startedAt: string;
}

export type BridgeConfigRead =
  | { status: 'ok'; config: BridgeConfig }
  | { status: 'missing' }
  | { status: 'legacy'; version: number }
  | { status: 'malformed'; error: string };

export function appDataDir(): string {
  if (process.env.OFFHAND_HOME) return path.resolve(process.env.OFFHAND_HOME);
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'offhand');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'offhand');
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'offhand');
}

export function bridgeConfigPath(): string {
  return path.join(appDataDir(), 'bridge.json');
}

export function tokenPath(): string {
  return path.join(appDataDir(), 'token');
}

export function logPath(): string {
  return path.join(appDataDir(), 'logs', 'usage.jsonl');
}

export function ensureAppDirs(): void {
  fs.mkdirSync(appDataDir(), { recursive: true });
  fs.mkdirSync(path.dirname(logPath()), { recursive: true });
}

const TOKEN_PATTERN = /^[a-f0-9]{32,}$/i;

function readToken(): string | null {
  try {
    const existing = fs.readFileSync(tokenPath(), 'utf8').trim();
    return TOKEN_PATTERN.test(existing) ? existing : null;
  } catch {
    return null;
  }
}

/**
 * Shared secret. Both the panel and the MCP server must resolve the same value,
 * so creation is race-safe: the first writer wins with O_EXCL and the loser
 * re-reads the winner's token instead of generating a second one.
 */
export function getOrCreateToken(): string {
  ensureAppDirs();

  const existing = readToken();
  if (existing) return existing;

  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(tokenPath(), `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = readToken();
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * Atomic publish. Windows can briefly lock the destination while a reader has
 * it open, so rename is retried a few times before giving up.
 */
export function writeBridgeConfig(config: BridgeConfig): void {
  ensureAppDirs();
  const file = bridgeConfigPath();
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temporary, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retryable || attempt >= 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
}

/** Detailed read used for diagnosis: why is there no usable config? */
export function readBridgeConfigFile(): BridgeConfigRead {
  let raw: string;
  try {
    raw = fs.readFileSync(bridgeConfigPath(), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'missing' };
    return { status: 'malformed', error: `${code ?? 'READ_FAILED'}: ${(error as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'malformed', error: 'bridge.json is not valid JSON' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { status: 'malformed', error: 'bridge.json is not an object' };
  }

  const value = parsed as Record<string, unknown>;
  const version = typeof value.version === 'number' ? value.version : 0;
  if (version !== BRIDGE_CONFIG_VERSION) {
    return { status: 'legacy', version };
  }

  if (
    typeof value.host !== 'string' ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    typeof value.token !== 'string' ||
    typeof value.pid !== 'number' ||
    (typeof value.startedAt !== 'string' && typeof value.startedAt !== 'number')
  ) {
    return { status: 'malformed', error: 'bridge.json is missing required fields' };
  }

  return {
    status: 'ok',
    config: {
      version: BRIDGE_CONFIG_VERSION,
      protocol: typeof value.protocol === 'number' ? value.protocol : PROTOCOL_VERSION,
      host: value.host,
      port: value.port,
      token: value.token,
      pid: value.pid,
      panelVersion: typeof value.panelVersion === 'string' ? value.panelVersion : 'unknown',
      startedAt: String(value.startedAt),
    },
  };
}

export function readBridgeConfig(): BridgeConfig | null {
  const result = readBridgeConfigFile();
  return result.status === 'ok' ? result.config : null;
}

/**
 * Reserved for `offhand doctor --fix` (Phase G). The panel never deletes the
 * file: a stale address is a diagnosis (`BRIDGE_STALE`), not an error to hide.
 */
export function removeBridgeConfig(expectedPid = process.pid): void {
  const existing = readBridgeConfig();
  if (existing && existing.pid !== expectedPid) return;
  fs.rmSync(bridgeConfigPath(), { force: true });
}
