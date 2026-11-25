import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bridgeConfigPath, readBridgeConfigFile, writeBridgeConfig } from '../src/shared/paths.js';

/**
 * Regression: the panel publishes `startedAt` as epoch milliseconds (a number),
 * while older configs and tests used an ISO string. Both must be accepted —
 * rejecting the panel's own format made the flipped bridge report BRIDGE_STALE.
 */
describe('readBridgeConfigFile', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'offhand-paths-'));
    process.env.OFFHAND_HOME = home;
  });

  afterEach(() => {
    delete process.env.OFFHAND_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const base = {
    version: 2 as const,
    protocol: 2,
    host: '127.0.0.1',
    port: 47823,
    token: 'a'.repeat(48),
    pid: 1234,
    panelVersion: '0.1.0',
  };

  it('accepts a numeric startedAt published by the panel', () => {
    fs.writeFileSync(
      bridgeConfigPath(),
      JSON.stringify({ ...base, startedAt: Date.now() }, null, 2),
      'utf8',
    );

    const result = readBridgeConfigFile();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(typeof result.config.startedAt).toBe('string');
  });

  it('still accepts an ISO string startedAt', () => {
    writeBridgeConfig({ ...base, startedAt: new Date().toISOString() });
    expect(readBridgeConfigFile().status).toBe('ok');
  });

  it('reports v1 files as legacy instead of malformed', () => {
    fs.writeFileSync(bridgeConfigPath(), JSON.stringify({ version: 1, port: 1234 }), 'utf8');
    const result = readBridgeConfigFile();
    expect(result).toEqual({ status: 'legacy', version: 1 });
  });
});
