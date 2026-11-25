import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocket, type RawData } from 'ws';
import { OffhandError } from '../shared/errors.js';
import { readBridgeConfigFile, type BridgeConfig } from '../shared/paths.js';
import type {
  AeSnapshot,
  BridgeDiagnosis,
  BridgeDiagnosisCode,
  BridgeState,
  BridgeStatus,
  CallMessage,
  ClientToPanelMessage,
  HelloMessage,
  PanelToClientMessage,
  ResultMessage,
  WelcomeMessage,
} from '../shared/protocol.js';
import { PROTOCOL_VERSION, VERSION } from '../shared/version.js';
import { logInfo } from './log.js';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  tool: string;
}

export interface BridgeOptions {
  /** First retry delay after a failed attempt. */
  retryBaseMs?: number;
  /** Ceiling for the exponential retry backoff. */
  retryMaxMs?: number;
  /** TCP + WebSocket upgrade deadline. */
  connectTimeoutMs?: number;
  /** How long the panel has to answer a hello with a welcome. */
  handshakeTimeoutMs?: number;
  /** Poll interval used while no bridge.json exists (or it is unreadable). */
  idlePollMs?: number;
  heartbeatMs?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_RETRY_BASE_MS = 300;
const DEFAULT_RETRY_MAX_MS = 2_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 4_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_POLL_MS = 400;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const HINTS: Record<BridgeDiagnosisCode, string> = {
  PANEL_NOT_RUNNING:
    'Open After Effects, then choose Window > Extensions > offhand. The panel publishes its address and this server dials in automatically.',
  BRIDGE_STALE:
    'The panel published an address but is not answering. Reopen Window > Extensions > offhand (or click Reconnect in the panel) and retry.',
  TOKEN_MISMATCH:
    'The panel and this server read different tokens from %APPDATA%\\offhand\\token. Reopen the panel to re-read it; if it persists, delete the token file and restart both sides.',
  VERSION_MISMATCH:
    'The panel and this server speak different bridge protocols. Update the panel (npm run build:extension) or the MCP server so both are the same version.',
  AE_BUSY:
    'After Effects may be showing a modal dialog or still running a long operation. Clear the dialog, then retry.',
  BRIDGE_OFFLINE:
    'Open the offhand panel in After Effects and retry.',
};

export class Bridge extends EventEmitter {
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly connectTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly idlePollMs: number;
  private readonly heartbeatMs: number;
  private readonly requestTimeoutMs: number;

  private state: BridgeState = 'idle';
  private socket: WebSocket | null = null;
  private loop: Promise<void> | null = null;
  private stopping = false;
  private sleepers = new Set<() => void>();

  private config: BridgeConfig | null = null;
  private configKey: string | null = null;
  private panelVersion: string | null = null;
  private ae: AeSnapshot | null = null;
  private connectedAt: string | null = null;
  private attempts = 0;
  private lastError: string | null = null;
  private diagnosis: BridgeDiagnosis | null = null;

  private readonly pending = new Map<string, PendingCall>();
  private heartbeat: NodeJS.Timeout | null = null;
  private lastPongAt = 0;
  private welcome: {
    resolve: (message: WelcomeMessage) => void;
    reject: (error: unknown) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private closed: Promise<{ code: number; reason: string }> | null = null;

  constructor(options: BridgeOptions = {}) {
    super();
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Starts the dial-in loop. Deliberately does **not** wait for a connection:
   * the MCP server must boot with After Effects closed.
   */
  async start(): Promise<void> {
    if (this.loop) return;
    this.stopping = false;
    logInfo(`bridge client started (protocol ${PROTOCOL_VERSION})`);
    this.loop = this.run();
  }

  isOnline(): boolean {
    return this.state === 'ready' && Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  status(): BridgeStatus {
    return {
      state: this.state,
      online: this.isOnline(),
      host: this.config?.host ?? null,
      port: this.config?.port ?? null,
      panelVersion: this.panelVersion,
      ae: this.ae,
      connectedAt: this.connectedAt,
      attempts: this.attempts,
      lastError: this.lastError,
      diagnosis: this.diagnosis,
    };
  }

  async call(tool: string, args: unknown, options: { timeoutMs?: number } = {}): Promise<unknown> {
    if (!this.isOnline() || !this.socket) {
      throw this.offlineError();
    }

    const id = crypto.randomUUID();
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? this.requestTimeoutMs);
    const message: CallMessage = {
      type: 'call',
      id,
      tool,
      args,
      timeoutMs,
      deadline: Date.now() + timeoutMs,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.setDiagnosis({
          code: 'AE_BUSY',
          message: `After Effects did not answer "${tool}" within ${Math.round(timeoutMs / 1000)}s.`,
          hint: HINTS.AE_BUSY,
        });
        reject(
          new OffhandError(
            'AE_BUSY',
            `After Effects did not answer "${tool}" within ${Math.round(timeoutMs / 1000)}s.`,
            { hint: HINTS.AE_BUSY },
          ),
        );
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, { resolve, reject, timer, tool });

      try {
        this.socket?.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new OffhandError('BRIDGE_DISCONNECTED', 'The panel disconnected before the call was sent.', {
            hint: HINTS.BRIDGE_STALE,
            cause: error,
          }),
        );
      }
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const wake of [...this.sleepers]) wake();
    this.teardown('The offhand server is shutting down.');
    this.setState('idle');

    const loop = this.loop;
    this.loop = null;
    if (loop) {
      try {
        await loop;
      } catch {
        // The loop is best-effort during shutdown.
      }
    }
  }

  private async run(): Promise<void> {
    let backoff = this.retryBaseMs;

    while (!this.stopping) {
      const read = readBridgeConfigFile();

      if (read.status !== 'ok') {
        this.config = null;
        this.configKey = null;
        this.panelVersion = null;
        this.ae = null;
        this.connectedAt = null;
        this.setState(read.status === 'missing' ? 'idle' : 'degraded');

        if (read.status === 'missing') {
          this.setDiagnosis({
            code: 'PANEL_NOT_RUNNING',
            message: 'No offhand bridge has been published yet.',
            hint: HINTS.PANEL_NOT_RUNNING,
          });
        } else if (read.status === 'legacy') {
          this.setDiagnosis({
            code: 'VERSION_MISMATCH',
            message: `bridge.json is version ${read.version || 'unknown'}; this server needs version 2.`,
            hint: HINTS.VERSION_MISMATCH,
          });
        } else {
          this.setDiagnosis({
            code: 'BRIDGE_STALE',
            message: `bridge.json could not be used (${read.error}).`,
            hint: HINTS.BRIDGE_STALE,
          });
        }

        await this.sleep(this.idlePollMs);
        continue;
      }

      const config = read.config;
      const key = `${config.host}:${config.port}:${config.startedAt}`;
      if (key !== this.configKey) {
        this.configKey = key;
        this.config = config;
        backoff = this.retryBaseMs;
      }

      this.attempts += 1;
      this.setState('connecting');

      try {
        const socket = await this.open(config);
        if (this.stopping) {
          socket.terminate();
          break;
        }

        this.socket = socket;
        this.attach(socket);
        this.setState('handshaking');

        const hello: HelloMessage = {
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          token: config.token,
          clientVersion: VERSION,
        };
        socket.send(JSON.stringify(hello));

        const welcome = await this.awaitWelcome();
        this.panelVersion = welcome.panelVersion;
        this.ae = welcome.ae ?? null;
        this.connectedAt = new Date().toISOString();
        this.lastError = null;
        this.setDiagnosis(null);
        this.setState('ready');
        this.startHeartbeat();
        logInfo(`panel connected (panel ${welcome.panelVersion}, AE ${welcome.ae?.version ?? 'unknown'})`);
        this.emit('online', this.ae);

        const closed = await this.awaitClose();
        if (!this.stopping) {
          this.lastError = `panel closed the connection (${closed.code}${closed.reason ? ` ${closed.reason}` : ''})`;
          this.setDiagnosis({
            code: 'BRIDGE_STALE',
            message: 'The offhand panel closed the bridge connection.',
            hint: HINTS.BRIDGE_STALE,
          });
        }
      } catch (error) {
        this.captureError(error);
      } finally {
        const wasOnline = this.state === 'ready';
        this.teardown();
        if (wasOnline) this.emit('offline');
      }

      if (this.stopping) break;

      this.setState('degraded');
      await this.sleep(backoff);
      backoff = Math.min(Math.round(backoff * 1.8), this.retryMaxMs);
    }

    this.setState('idle');
  }

  private open(config: BridgeConfig): Promise<WebSocket> {
    const url = `ws://${config.host}:${config.port}`;
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url, {
        handshakeTimeout: this.connectTimeoutMs,
        maxPayload: 32 * 1024 * 1024,
      });

      const timer = setTimeout(() => {
        cleanup();
        socket.terminate();
        reject(
          new OffhandError('BRIDGE_STALE', `Timed out connecting to ${url}.`, {
            hint: HINTS.BRIDGE_STALE,
          }),
        );
      }, this.connectTimeoutMs);
      timer.unref();

      const onOpen = () => {
        cleanup();
        resolve(socket);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(
          new OffhandError('BRIDGE_STALE', `Could not connect to ${url}: ${error.message}`, {
            hint: HINTS.BRIDGE_STALE,
            cause: error,
          }),
        );
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('open', onOpen);
        socket.off('error', onError);
      };

      socket.once('open', onOpen);
      socket.once('error', onError);
    });
  }

  private attach(socket: WebSocket): void {
    this.lastPongAt = Date.now();

    this.closed = new Promise((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    socket.on('message', (data) => this.handleMessage(socket, data));
    socket.on('error', (error) => {
      this.lastError = error.message;
      logInfo(`bridge socket error: ${error.message}`);
    });
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    if (socket !== this.socket) return;

    let message: PanelToClientMessage;
    try {
      message = JSON.parse(data.toString()) as PanelToClientMessage;
    } catch {
      this.lastError = 'the panel sent invalid JSON';
      socket.close(4002, 'Invalid JSON');
      return;
    }

    switch (message.type) {
      case 'welcome':
        this.resolveWelcome(message);
        break;
      case 'error':
        this.failWelcome(this.diagnosisFromError(message.code, message.message));
        break;
      case 'result':
        this.handleResult(message);
        break;
      case 'ping':
        this.send({ type: 'pong', ts: message.ts });
        break;
      case 'pong':
        this.lastPongAt = Date.now();
        break;
      case 'event':
        this.emit('event', message.event, message.data);
        break;
      default:
        break;
    }
  }

  private handleResult(message: ResultMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(message.id);

    if (message.ok) {
      this.setDiagnosis(null);
      pending.resolve(message.data);
      return;
    }

    pending.reject(
      new OffhandError(
        (message.error?.code as never) ?? 'HOST_ERROR',
        message.error?.message ?? 'After Effects returned an unknown error.',
        { hint: message.error?.hint, details: message.error?.details },
      ),
    );
  }

  private awaitWelcome(): Promise<WelcomeMessage> {
    return new Promise<WelcomeMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.welcome = null;
        reject(
          new OffhandError(
            'BRIDGE_STALE',
            'The panel opened the socket but did not complete the handshake.',
            { hint: HINTS.BRIDGE_STALE },
          ),
        );
      }, this.handshakeTimeoutMs);
      timer.unref();
      this.welcome = { resolve, reject, timer };
    });
  }

  private resolveWelcome(message: WelcomeMessage): void {
    const welcome = this.welcome;
    if (!welcome) return;
    clearTimeout(welcome.timer);
    this.welcome = null;

    if (message.protocol !== PROTOCOL_VERSION) {
      welcome.reject(
        new OffhandError(
          'VERSION_MISMATCH',
          `The panel speaks protocol ${message.protocol}, this server speaks ${PROTOCOL_VERSION}.`,
          { hint: HINTS.VERSION_MISMATCH },
        ),
      );
      return;
    }
    welcome.resolve(message);
  }

  private failWelcome(error: OffhandError): void {
    const welcome = this.welcome;
    if (!welcome) return;
    clearTimeout(welcome.timer);
    this.welcome = null;
    welcome.reject(error);
  }

  private awaitClose(): Promise<{ code: number; reason: string }> {
    return this.closed ?? new Promise(() => {});
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeat = setInterval(() => {
      if (!this.isOnline()) return;
      if (Date.now() - this.lastPongAt > this.heartbeatMs * 3) {
        this.lastError = 'panel heartbeat expired';
        this.socket?.terminate();
        return;
      }
      this.send({ type: 'ping', ts: Date.now() });
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private teardown(reason = 'The panel disconnected before the call completed.'): void {
    this.stopHeartbeat();
    this.failWelcome(new OffhandError('BRIDGE_DISCONNECTED', reason));

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new OffhandError('BRIDGE_DISCONNECTED', `The panel disconnected while "${pending.tool}" was running.`, { hint: HINTS.BRIDGE_STALE }));
      this.pending.delete(id);
    }

    const socket = this.socket;
    this.socket = null;
    this.closed = null;
    this.panelVersion = null;
    this.ae = null;
    this.connectedAt = null;

    if (socket) {
      try {
        // Keep the close listener: `awaitClose()` must resolve so the retry loop
        // can observe the disconnect instead of hanging on stop().
        socket.terminate();
      } catch {
        // Ignore close races.
      }
    }
  }

  private send(message: ClientToPanelMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private offlineError(): OffhandError {
    const diagnosis = this.diagnosis;
    if (diagnosis) {
      return new OffhandError(diagnosis.code, diagnosis.message, { hint: diagnosis.hint });
    }
    return new OffhandError('BRIDGE_OFFLINE', 'After Effects is not connected to offhand.', {
      hint: HINTS.BRIDGE_OFFLINE,
    });
  }

  private captureError(error: unknown): void {
    if (error instanceof OffhandError) {
      this.lastError = error.message;
      const mapped: BridgeDiagnosisCode =
        error.code === 'PANEL_NOT_RUNNING' ||
        error.code === 'BRIDGE_STALE' ||
        error.code === 'TOKEN_MISMATCH' ||
        error.code === 'VERSION_MISMATCH' ||
        error.code === 'AE_BUSY'
          ? error.code
          : 'BRIDGE_OFFLINE';
      this.setDiagnosis({
        code: mapped,
        message: error.message,
        hint: error.hint ?? HINTS[mapped],
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.setDiagnosis({
      code: 'BRIDGE_OFFLINE',
      message: `Could not reach the offhand panel: ${message}`,
      hint: HINTS.BRIDGE_OFFLINE,
    });
  }

  private diagnosisFromError(code: string, message: string): OffhandError {
    const mapped: BridgeDiagnosisCode =
      code === 'AUTH_FAILED' ? 'TOKEN_MISMATCH' : code === 'PROTOCOL_MISMATCH' ? 'VERSION_MISMATCH' : 'BRIDGE_STALE';
    return new OffhandError(mapped, message, { hint: HINTS[mapped] });
  }

  private setDiagnosis(diagnosis: BridgeDiagnosis | null): void {
    const changed =
      this.diagnosis?.code !== diagnosis?.code || this.diagnosis?.message !== diagnosis?.message;
    this.diagnosis = diagnosis;
    if (changed) this.emit('diagnosis', diagnosis);
  }

  private setState(state: BridgeState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
  }

  private sleep(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        this.sleepers.delete(done);
        resolve();
      };
      timer = setTimeout(done, ms);
      timer.unref();
      this.sleepers.add(done);
    });
  }
}
