import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '../src/server/bridge.js';
import { readBridgeConfig } from '../src/shared/paths.js';

let home: string;
let bridge: Bridge;
let clients: WebSocket[];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'offhand-test-'));
  process.env.OFFHAND_HOME = home;
  bridge = new Bridge({ port: 0, heartbeatMs: 60_000, authTimeoutMs: 2_000 });
  clients = [];
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  clients = [];
  await bridge.stop();
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.OFFHAND_HOME;
});

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    clients.push(client);
    client.once('open', () => resolve(client));
    client.once('error', reject);
  });
}

function nextMessage(client: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a message')), 2_000);
    client.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe('bridge', () => {
  it('writes a bridge file and answers a correlated call', async () => {
    await bridge.start();

    const status = bridge.status();
    expect(status.online).toBe(false);
    expect(status.port).toBeTypeOf('number');

    const config = readBridgeConfig();
    expect(config?.port).toBe(status.port);
    expect(config?.token).toHaveLength(48);

    const client = await connectClient(status.port as number);
    client.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        token: config?.token,
        panelVersion: 'test',
        ae: null,
      }),
    );

    const welcome = await nextMessage(client);
    expect(welcome.type).toBe('welcome');
    expect(bridge.status().online).toBe(true);
    expect(bridge.status().panelVersion).toBe('test');

    const callPromise = bridge.call('status', {});
    const call = await nextMessage(client);
    expect(call.type).toBe('call');
    expect(call.tool).toBe('status');
    expect(call.id).toBeTypeOf('string');

    client.send(
      JSON.stringify({
        type: 'result',
        id: call.id,
        ok: true,
        data: { version: '23.6.0' },
      }),
    );

    await expect(callPromise).resolves.toEqual({ version: '23.6.0' });
  });

  it('rejects the wrong token', async () => {
    await bridge.start();
    const config = readBridgeConfig();
    const client = await connectClient(config?.port as number);

    const closed = new Promise<number>((resolve) => client.once('close', resolve));
    client.send(
      JSON.stringify({
        type: 'hello',
        protocol: 1,
        token: 'wrong-token',
        panelVersion: 'test',
      }),
    );

    expect(await closed).toBe(4003);
    expect(bridge.status().online).toBe(false);
  });

  it('rejects calls while offline', async () => {
    await expect(bridge.call('status', {})).rejects.toMatchObject({
      code: 'BRIDGE_OFFLINE',
    });
  });

  it('removes the bridge file on stop', async () => {
    await bridge.start();
    expect(readBridgeConfig()).not.toBeNull();
    await bridge.stop();
    expect(readBridgeConfig()).toBeNull();
  });
});
