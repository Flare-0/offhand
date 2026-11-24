import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { OffhandError } from '../shared/errors.js';
import {
  getOrCreateToken,
  removeBridgeConfig,
  writeBridgeConfig,
} from '../shared/paths.js';
import type {
  AeSnapshot,
  BridgeStatus,
  HelloMessage,
  PanelToServerMessage,
  ResultMessage,
  ServerToPanelMessage,
} from '../shared/protocol.js';
import { PROTOCOL_VERSION, VERSION } from '../shared/version.js';
import { logInfo } from './log.js';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  startedAt: number;
  tool: string;
}

export interface BridgeOptions {
  host?: string;
  port?: number;
  authTimeoutMs?: number;
  heartbeatMs?: number;
  requestTimeoutMs?: number;
}

const LOCAL_ORIGIN = /^(file:\/\/|null$|chrome-extension:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$)/i;

export class Bridge extends EventEmitter {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly authTimeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly requestTimeoutMs: number;

  private server: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private authenticated = false;
  private token = '';
  private actualPort: number | null = null;
  private panelVersion: string | null = null;
  private ae: AeSnapshot | null = null;
  private connectedAt: string | null = null;
  private lastPongAt = 0;
  private authTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, PendingCall>();

  constructor(options: BridgeOptions = {}) {
    super();
    this.host = options.host ?? '127.0.0.1';
    this.requestedPort = options.port ?? 0;
    this.authTimeoutMs = options.authTimeoutMs ?? 8_000;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.token = getOrCreateToken();

    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.requestedPort,
        maxPayload: 16 * 1024 * 1024,
      });
      this.server = server;

      const onError = (error: Error) => {
        cleanup();
        reject(
          new OffhandError('BRIDGE_OFFLINE', `Could not start the bridge on ${this.host}:${this.requestedPort}: ${error.message}`, {
            hint: 'Another offhand server may already be running. Close the other MCP client or stop the other server, then retry.',
            cause: error,
          }),
        );
      };

      const onListening = () => {
        cleanup();
        this.actualPort = (server.address() as AddressInfo).port;
        resolve();
      };

      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.on('connection', (socket, request) => this.handleConnection(socket, request));
    });

    if (this.actualPort === null) {
      throw new OffhandError('BRIDGE_OFFLINE', 'The bridge started without a port.');
    }

    writeBridgeConfig({
      version: 1,
      host: this.host,
      port: this.actualPort,
      token: this.token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });

    this.heartbeat = setInterval(() => this.ping(), this.heartbeatMs);
    this.heartbeat.unref();

    logInfo(`bridge listening on ws://${this.host}:${this.actualPort}`);
  }

  isOnline(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN && this.authenticated);
  }

  status(): BridgeStatus {
    return {
      online: this.isOnline(),
      host: this.host,
      port: this.actualPort,
      panelVersion: this.panelVersion,
      ae: this.ae,
      connectedAt: this.connectedAt,
    };
  }

  async call(tool: string, args: unknown, options: { timeoutMs?: number } = {}): Promise<unknown> {
    if (!this.isOnline() || !this.socket) {
      throw new OffhandError('BRIDGE_OFFLINE', 'After Effects is not connected to offhand.', {
        hint: 'Open After Effects, then choose Window > Extensions > offhand. The panel reconnects automatically.',
      });
    }

    const id = crypto.randomUUID();
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? this.requestTimeoutMs);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new OffhandError(
            'BRIDGE_TIMEOUT',
            `After Effects did not answer "${tool}" within ${Math.round(timeoutMs / 1000)}s.`,
            {
              hint: 'The operation may still be running. Check After Effects, then retry with a smaller scope.',
            },
          ),
        );
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer, startedAt: Date.now(), tool });

      const sent = this.send({ type: 'call', id, tool, args, timeoutMs });
      if (!sent) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new OffhandError('BRIDGE_DISCONNECTED', 'The After Effects panel disconnected before the call was sent.', {
            hint: 'Reopen Window > Extensions > offhand and retry.',
          }),
        );
      }
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new OffhandError('BRIDGE_DISCONNECTED', 'The offhand server stopped before the call completed.'),
      );
      this.pending.delete(id);
    }

    if (this.socket) {
      try {
        this.socket.close(1001, 'offhand server stopping');
      } catch {
        // Ignore close races.
      }
      this.socket = null;
    }
    this.authenticated = false;

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    removeBridgeConfig(process.pid);
    this.actualPort = null;
  }

  private handleConnection(socket: WebSocket, request: { headers: { origin?: string } }): void {
    const origin = request.headers.origin;
    if (origin && !LOCAL_ORIGIN.test(origin)) {
      socket.close(4003, 'Invalid origin');
      logInfo(`rejected panel connection from origin ${origin}`);
      return;
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(4001, 'Replaced by a newer panel connection');
    }

    this.socket = socket;
    this.authenticated = false;
    this.connectedAt = null;
    this.panelVersion = null;
    this.ae = null;

    this.authTimer = setTimeout(() => {
      socket.close(4003, 'Authentication timeout');
    }, this.authTimeoutMs);
    this.authTimer.unref();

    socket.on('message', (data) => this.handleMessage(socket, data));
    socket.on('close', () => this.handleClose(socket));
    socket.on('error', (error) => {
      logInfo(`panel socket error: ${error.message}`);
    });
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    let message: PanelToServerMessage;
    try {
      message = JSON.parse(data.toString()) as PanelToServerMessage;
    } catch {
      socket.close(4002, 'Invalid JSON');
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      socket.close(4002, 'Invalid message');
      return;
    }

    if (!this.authenticated) {
      if (message.type !== 'hello') {
        socket.close(4003, 'Authenticate first');
        return;
      }
      this.handleHello(socket, message);
      return;
    }

    switch (message.type) {
      case 'result':
        this.handleResult(message);
        break;
      case 'pong':
        this.lastPongAt = Date.now();
        break;
      case 'event':
        this.emit('event', message.event, message.data);
        break;
      case 'ping':
        this.send({ type: 'pong', ts: message.ts });
        break;
      case 'hello':
        break;
      default:
        break;
    }
  }

  private handleHello(socket: WebSocket, message: HelloMessage): void {
    if (message.protocol !== PROTOCOL_VERSION) {
      this.send({
        type: 'error',
        code: 'PROTOCOL_MISMATCH',
        message: `Panel protocol ${String(message.protocol)} does not match server protocol ${PROTOCOL_VERSION}.`,
      });
      socket.close(4004, 'Protocol mismatch');
      return;
    }

    if (typeof message.token !== 'string' || !safeEqual(message.token, this.token)) {
      this.send({
        type: 'error',
        code: 'AUTH_FAILED',
        message: 'The panel token does not match this offhand server.',
      });
      socket.close(4003, 'Authentication failed');
      return;
    }

    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }

    this.authenticated = true;
    this.panelVersion = message.panelVersion ?? null;
    this.ae = message.ae ?? null;
    this.connectedAt = new Date().toISOString();
    this.lastPongAt = Date.now();

    this.send({
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      serverVersion: VERSION,
    });

    logInfo(
      `panel connected (panel ${this.panelVersion ?? 'unknown'}, AE ${this.ae?.version ?? 'unknown'})`,
    );
    this.emit('online', this.ae);
  }

  private handleResult(message: ResultMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.ok) {
      pending.resolve(message.data);
      return;
    }

    const error = new OffhandError(
      (message.error?.code as never) ?? 'HOST_ERROR',
      message.error?.message ?? 'After Effects returned an unknown error.',
      {
        hint: message.error?.hint,
        details: message.error?.details,
      },
    );
    pending.reject(error);
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;

    this.socket = null;
    this.authenticated = false;
    this.connectedAt = null;
    this.panelVersion = null;
    this.ae = null;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new OffhandError(
          'BRIDGE_DISCONNECTED',
          `The After Effects panel disconnected while "${pending.tool}" was running.`,
          { hint: 'Reopen Window > Extensions > offhand. If the operation was a render, check After Effects before retrying.' },
        ),
      );
      this.pending.delete(id);
    }

    logInfo('panel disconnected');
    this.emit('offline');
  }

  private ping(): void {
    if (!this.isOnline()) return;

    if (Date.now() - this.lastPongAt > this.heartbeatMs * 3) {
      logInfo('panel heartbeat expired; closing stale connection');
      this.socket?.terminate();
      return;
    }

    this.send({ type: 'ping', ts: Date.now() });
  }

  private send(message: ServerToPanelMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.authenticated) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
