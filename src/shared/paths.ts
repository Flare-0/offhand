import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BridgeConfig {
  version: 1;
  host: string;
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

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

export function getOrCreateToken(): string {
  ensureAppDirs();
  const file = tokenPath();

  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32,}$/i.test(existing)) return existing;
  } catch {
    // Missing or unreadable token files are replaced below.
  }

  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}

export function writeBridgeConfig(config: BridgeConfig): void {
  ensureAppDirs();
  const file = bridgeConfigPath();
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.rmSync(file, { force: true });
  fs.renameSync(temporary, file);
}

export function readBridgeConfig(): BridgeConfig | null {
  try {
    const raw = fs.readFileSync(bridgeConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    if (
      parsed.version !== 1 ||
      typeof parsed.host !== 'string' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.pid !== 'number'
    ) {
      return null;
    }
    return parsed as BridgeConfig;
  } catch {
    return null;
  }
}

export function removeBridgeConfig(expectedPid = process.pid): void {
  const existing = readBridgeConfig();
  if (existing && existing.pid !== expectedPid) return;
  fs.rmSync(bridgeConfigPath(), { force: true });
}
