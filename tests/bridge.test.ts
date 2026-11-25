import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '../src/server/bridge.js';
import {
  BRIDGE_CONFIG_VERSION,
  getOrCreateToken,
  readBridgeConfig,
  writeBridgeConfig,
} from '../src/shared/paths.js';
import { PROTOCOL_VERSION } from '../src/shared/version.js';

let home: string;
let bridge: Bridge;
let panels: FakePanel[];

class FakePanel {
  server: WebSocketServer | null = null;
  port = 0;
  token = '';
  sockets = new Set<WebSocket>();
  hellos: any[] = [];
  calls: any[] = [];
  onCall: ((call: any, socket: WebSocket) => void) | null = null;

  async start(
    options: {
      port?: number;
      publish?: boolean;
      settings?: { allowRawScripts: boolean };
    } = {},
  ): Promise<void> {
    this.token = getOrCreateToken();
    const server = new WebSocketServer({ host: '127.0.0.1', port: options.port ?? 0 });
    this.server = server;
    await once(server, 'listening');
    this.port = (server.address() as net.AddressInfo).port;

    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === 'hello') {
          this.hellos.push(message);
          if (message.token !== this.token) {
            socket.send(
              JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'bad token' }),
            );
            socket.close(4003, 'Authentication failed');
            return;
          }
          socket.send(
            JSON.stringify({
              type: 'welcome',
              protocol: PROTOCOL_VERSION,
              panelVersion: 'test',
              ae: { version: '23.6.0', project: null, comp: null },
              settings: options.settings ?? { allowRawScripts: false },
            }),
          );
        } else if (message.type === 'call') {
          this.calls.push(message);
          this.onCall?.(message, socket);
        } else if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', ts: message.ts }));
        }
      });
    });

    if (options.publish !== false) this.publish();
  }

  publish(token = this.token): void {
    writeBridgeConfig({
      version: BRIDGE_CONFIG_VERSION,
      protocol: PROTOCOL_VERSION,
      host: '127.0.0.1',
      port: this.port,
      token,
      pid: process.pid,
      panelVersion: 'test',
      startedAt: new Date().toISOString(),
    });
  }

  answer(call: any, data: unknown): void {
    const socket = [...this.sockets][0];
    socket?.send(JSON.stringify({ type: 'result', id: call.id, ok: true, data }));
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'offhand-test-'));
  process.env.OFFHAND_HOME = home;
  bridge = new Bridge({
    retryBaseMs: 25,
    retryMaxMs: 50,
    connectTimeoutMs: 500,
    handshakeTimeoutMs: 500,
    idlePollMs: 25,
    heartbeatMs: 60_000,
    requestTimeoutMs: 1_000,
  });
  panels = [];
});

afterEach(async () => {
  await bridge.stop();
  for (const panel of panels) await panel.stop();
  panels = [];
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.OFFHAND_HOME;
});

async function newPanel(
  options: {
    port?: number;
    publish?: boolean;
    settings?: { allowRawScripts: boolean };
  } = {},
): Promise<FakePanel> {
  const panel = new FakePanel();
  panels.push(panel);
  await panel.start(options);
  return panel;
}

describe('bridge client', () => {
  it('reports PANEL_NOT_RUNNING when the panel has not published an address', async () => {
    await bridge.start();

    await waitFor(() => bridge.status().diagnosis?.code === 'PANEL_NOT_RUNNING');
    const status = bridge.status();
    expect(status.online).toBe(false);
    expect(status.state).toBe('idle');
    expect(status.diagnosis?.hint).toMatch(/Window > Extensions > offhand/);

    await expect(bridge.call('status', {})).rejects.toMatchObject({ code: 'PANEL_NOT_RUNNING' });
  });

  it('dials the panel, authenticates, and answers a correlated call', async () => {
    const panel = await newPanel();
    panel.onCall = (call, socket) => {
      socket.send(JSON.stringify({ type: 'result', id: call.id, ok: true, data: { version: '23.6.0' } }));
    };

    await bridge.start();
    await waitFor(() => bridge.isOnline());

    const config = readBridgeConfig();
    expect(config?.port).toBe(panel.port);
    expect(config?.token).toHaveLength(48);
    expect(panel.hellos[0]).toMatchObject({ protocol: PROTOCOL_VERSION, token: config?.token });

    await expect(bridge.call('status', {})).resolves.toEqual({ version: '23.6.0' });

    const call = panel.calls[0];
    expect(call.tool).toBe('status');
    expect(call.id).toBeTypeOf('string');
    expect(call.deadline).toBeGreaterThan(Date.now());
    expect(bridge.status()).toMatchObject({ state: 'ready', panelVersion: 'test', online: true });
  });

  it('mirrors the panel raw-script setting and follows live changes', async () => {
    const panel = await newPanel({ settings: { allowRawScripts: true } });
    await bridge.start();
    await waitFor(() => bridge.isOnline());

    expect(bridge.status().allowRawScripts).toBe(true);

    const socket = [...panel.sockets][0];
    socket.send(
      JSON.stringify({ type: 'event', event: 'settings', data: { allowRawScripts: false } }),
    );
    await waitFor(() => !bridge.status().allowRawScripts);
    expect(bridge.status().allowRawScripts).toBe(false);
  });

  it('reports TOKEN_MISMATCH when the panel rejects the token', async () => {
    const panel = await newPanel({ publish: false });
    panel.publish('f'.repeat(48));

    await bridge.start();
    await waitFor(() => bridge.status().diagnosis?.code === 'TOKEN_MISMATCH');

    expect(bridge.status().online).toBe(false);
    await expect(bridge.call('status', {})).rejects.toMatchObject({ code: 'TOKEN_MISMATCH' });
  });

  it('reports BRIDGE_STALE when bridge.json points at a closed port', async () => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    writeBridgeConfig({
      version: BRIDGE_CONFIG_VERSION,
      protocol: PROTOCOL_VERSION,
      host: '127.0.0.1',
      port,
      token: getOrCreateToken(),
      pid: process.pid,
      panelVersion: 'test',
      startedAt: new Date().toISOString(),
    });

    await bridge.start();
    await waitFor(() => bridge.status().diagnosis?.code === 'BRIDGE_STALE');
    expect(bridge.status().state).toBe('degraded');
  });

  it('reports VERSION_MISMATCH for a version 1 bridge.json', async () => {
    fs.writeFileSync(
      path.join(home, 'bridge.json'),
      JSON.stringify({ version: 1, host: '127.0.0.1', port: 1, token: 'x', pid: 1 }),
    );

    await bridge.start();
    await waitFor(() => bridge.status().diagnosis?.code === 'VERSION_MISMATCH');
  });

  it('reconnects after the panel restarts', async () => {
    const panel = await newPanel();
    await bridge.start();
    await waitFor(() => bridge.isOnline());

    const port = panel.port;
    await panel.stop();
    await waitFor(() => !bridge.isOnline());

    const restarted = await newPanel({ port });
    restarted.onCall = (call, socket) => {
      socket.send(JSON.stringify({ type: 'result', id: call.id, ok: true, data: { version: '23.6.0' } }));
    };

    await waitFor(() => bridge.isOnline());
    await expect(bridge.call('status', {})).resolves.toEqual({ version: '23.6.0' });
  });

  it('reports AE_BUSY when the panel never answers a call', { timeout: 15_000 }, async () => {
    const panel = await newPanel();
    panel.onCall = () => {
      // Deliberately never answer: simulates a modal dialog blocking AE.
    };

    await bridge.start();
    await waitFor(() => bridge.isOnline());

    await expect(bridge.call('status', {})).rejects.toMatchObject({ code: 'AE_BUSY' });
    expect(bridge.status().diagnosis?.code).toBe('AE_BUSY');
  });
});
