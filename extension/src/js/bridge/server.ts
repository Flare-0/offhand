// The panel owns the bridge: it listens on localhost, publishes bridge.json,
// and answers calls from any number of MCP server processes.
//
// Three rules shape this file:
//  1. Never swallow an error. Every failure lands in `lastError`, the log, and
//     the UI — the old panel's silent `null` is what made it undebuggable.
//  2. Never hang. Each call carries an absolute deadline; a call that misses it
//     answers AE_BUSY and releases the queue.
//  3. Never run host calls concurrently. ExtendScript is single-threaded and
//     blocks After Effects, so calls are serialized through one queue.

import type {
  AeSnapshot,
  BridgeConfig,
  CallMessage,
  HelloMessage,
  PanelSettings,
  PanelToClientMessage,
  SerializedError,
} from "./types";
import { PANEL_PROTOCOL_VERSION } from "./types";
import {
  BRIDGE_HOST,
  PANEL_VERSION,
  PREFERRED_PORT,
  bridgeConfigPath,
  buildBridgeConfig,
  getOrCreateToken,
  nodeAvailable,
  writeBridgeConfig,
} from "./config";
import { loadSettings, saveSettings } from "./settings";
import { callHost, HostCallError } from "./host";

const AUTH_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15000;
const PONG_TIMEOUT_MS = 45000;
const DEFAULT_CALL_TIMEOUT_MS = 30000;
const MIN_CALL_TIMEOUT_MS = 250;
const MAX_CALL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOG_ENTRIES = 100;

type WsSocket = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  terminate: () => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
};

type WsServer = {
  on: (event: string, listener: (...args: any[]) => void) => void;
  close: (callback?: () => void) => void;
  address: () => { port: number } | string | null;
};

type WsModule = {
  WebSocketServer: new (options: Record<string, unknown>) => WsServer;
};

export type PanelState = "idle" | "listening" | "ready" | "degraded";

export type PanelLogLevel = "info" | "warn" | "error";

export type PanelLog = {
  id: number;
  at: number;
  level: PanelLogLevel;
  message: string;
};

export type PanelStatus = {
  state: PanelState;
  host: string;
  port: number | null;
  clients: number;
  panelVersion: string;
  /** Absolute path reported by the connected MCP server, if any. */
  serverPath: string | null;
  startedAt: number | null;
  lastError: string | null;
  ae: AeSnapshot | null;
  settings: PanelSettings;
};

type Session = {
  socket: WsSocket;
  authed: boolean;
  authTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  lastSeen: number;
};

type Job = {
  session: Session;
  id: string;
  tool: string;
  args: Record<string, unknown>;
  deadline: number;
};

class DeadlineExceeded extends Error {
  constructor() {
    super("The host did not answer before the deadline.");
    this.name = "DeadlineExceeded";
  }
}

const messageOf = (error: unknown): string => {
  if (error instanceof HostCallError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

const loadWs = (): WsModule | null => {
  if (typeof window === "undefined" || !window.cep_node) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // @ts-ignore - provided by the CEP Node runtime, resolved from dist/cep/node_modules
    return require("ws") as WsModule;
  } catch {
    return null;
  }
};

const withDeadline = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineExceeded()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

class PanelBridge {
  private wss: WsServer | null = null;
  private wsModule: WsModule | null = null;
  private port: number | null = null;
  private token: string | null = null;
  private startedAt: number | null = null;
  private state: PanelState = "idle";
  private lastError: string | null = null;
  private ae: AeSnapshot | null = null;
  private serverPath: string | null = null;
  private settings: PanelSettings = { allowRawScripts: false };
  private sessions = new Set<Session>();
  private queue: Job[] = [];
  private busy = false;
  private starting: Promise<void> | null = null;
  private logs: PanelLog[] = [];
  private logId = 0;
  private listeners = new Set<(status: PanelStatus) => void>();
  private logListeners = new Set<(logs: PanelLog[]) => void>();

  /** Idempotent: StrictMode double-mounts and Reconnect can race. */
  start(): Promise<void> {
    if (this.wss) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.boot().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async restart(): Promise<void> {
    this.log("info", "Reconnect requested.");
    this.queue = [];
    this.busy = false;
    this.lastError = null;
    this.setState("idle");

    for (const session of [...this.sessions]) {
      this.dropSession(session, 4000, "RESTART");
    }

    const wss = this.wss;
    this.wss = null;
    this.port = null;
    if (wss) {
      await new Promise<void>((resolve) => {
        try {
          wss.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
    await this.start();
  }

  status(): PanelStatus {
    return {
      state: this.state,
      host: BRIDGE_HOST,
      port: this.port,
      clients: [...this.sessions].filter((session) => session.authed).length,
      panelVersion: PANEL_VERSION,
      serverPath: this.serverPath,
      startedAt: this.startedAt,
      lastError: this.lastError,
      ae: this.ae,
      settings: { ...this.settings },
    };
  }

  configPath(): string {
    try {
      return bridgeConfigPath();
    } catch {
      return "";
    }
  }

  /**
   * Turns the raw-ExtendScript gate on or off. Panel-owned by design: the MCP
   * server can observe the setting but never change it.
   */
  setAllowRawScripts(enabled: boolean): void {
    if (this.settings.allowRawScripts === enabled) return;
    this.settings = { ...this.settings, allowRawScripts: enabled };
    try {
      this.settings = saveSettings(this.settings);
    } catch (error) {
      this.log("error", `Could not save settings: ${messageOf(error)}`);
    }

    this.log(
      enabled ? "warn" : "info",
      enabled
        ? "Raw scripts enabled: the `execute` tool can now run arbitrary ExtendScript."
        : "Raw scripts disabled: `execute` calls will be rejected.",
    );

    for (const session of this.sessions) {
      if (!session.authed) continue;
      this.send(session, {
        type: "event",
        event: "settings",
        data: { ...this.settings },
      });
    }
    this.emitStatus();
  }

  subscribe(listener: (status: PanelStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => this.listeners.delete(listener);
  }

  onLog(listener: (logs: PanelLog[]) => void): () => void {
    this.logListeners.add(listener);
    listener([...this.logs]);
    return () => this.logListeners.delete(listener);
  }

  private async boot(): Promise<void> {
    if (!nodeAvailable()) {
      this.fail(
        "The panel has no Node runtime, so it cannot host the bridge. " +
          "Add --enable-nodejs to the CEP parameters and restart After Effects.",
      );
      return;
    }

    const ws = loadWs();
    if (!ws) {
      this.fail(
        "Could not load the bundled `ws` module. Rebuild the extension with " +
          "`npm run build:extension`.",
      );
      return;
    }
    this.wsModule = ws;
    this.settings = loadSettings();
    this.log(
      "info",
      this.settings.allowRawScripts
        ? "Raw scripts are enabled."
        : "Raw scripts are disabled (the `execute` tool is blocked).",
    );

    let token: string;
    try {
      token = getOrCreateToken();
    } catch (error) {
      this.fail(`Could not create the bridge token: ${messageOf(error)}`);
      return;
    }
    this.token = token;

    let server: WsServer;
    let port: number;
    try {
      const preferred = await this.listenOn(ws, PREFERRED_PORT).catch(
        () => null,
      );
      const picked = preferred ?? (await this.listenOn(ws, 0));
      server = picked.server;
      port = picked.port;
    } catch (error) {
      this.fail(`Could not open a listening socket: ${messageOf(error)}`);
      return;
    }

    this.wss = server;
    this.port = port;
    this.startedAt = Date.now();
    server.on("connection", (socket: WsSocket) => this.accept(socket));
    server.on("error", (error: unknown) =>
      this.log("error", `Bridge socket error: ${messageOf(error)}`),
    );

    try {
      writeBridgeConfig(buildBridgeConfig(port, token, this.startedAt));
    } catch (error) {
      this.fail(`Could not write ${bridgeConfigPath()}: ${messageOf(error)}`);
      return;
    }

    this.setState("listening");
    this.log("info", `Listening on ws://${BRIDGE_HOST}:${port}`);
  }

  private listenOn(
    ws: WsModule,
    port: number,
  ): Promise<{ server: WsServer; port: number }> {
    return new Promise((resolve, reject) => {
      const server = new ws.WebSocketServer({
        host: BRIDGE_HOST,
        port,
        clientTracking: false,
      });
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          server.close();
        } catch {
          // Already closed.
        }
        reject(new Error(`timed out binding ${BRIDGE_HOST}:${port}`));
      }, 5000);

      server.on("listening", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const address = server.address();
        const actual =
          typeof address === "object" && address !== null ? address.port : port;
        resolve({ server, port: actual });
      });

      server.on("error", (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private accept(socket: WsSocket): void {
    const session: Session = {
      socket,
      authed: false,
      authTimer: null,
      pingTimer: null,
      lastSeen: Date.now(),
    };
    this.sessions.add(session);

    session.authTimer = setTimeout(() => {
      if (session.authed) return;
      this.log("warn", "A client connected but never sent a hello; closing it.");
      this.sendError(
        session,
        "AUTH_TIMEOUT",
        "No hello within 5 seconds.",
        "The MCP client is probably using an older offhand builder; update it.",
      );
      this.dropSession(session, 4001, "AUTH_TIMEOUT");
    }, AUTH_TIMEOUT_MS);

    socket.on("message", (raw: unknown) => this.handleMessage(session, raw));
    socket.on("close", () => this.endSession(session));
    socket.on("error", () => this.endSession(session));
    this.emitStatus();
  }

  private handleMessage(session: Session, raw: unknown): void {
    session.lastSeen = Date.now();
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      this.sendError(
        session,
        "INVALID_JSON",
        "The bridge received a message that is not JSON.",
        "This is an offhand protocol bug; restart After Effects and the MCP client.",
      );
      return;
    }

    switch (message.type) {
      case "hello":
        this.handleHello(session, message as unknown as HelloMessage);
        return;
      case "ping":
        this.send(session, {
          type: "pong",
          ts: typeof message.ts === "number" ? message.ts : Date.now(),
        });
        return;
      case "pong":
        return;
      case "call":
        if (!session.authed) {
          this.sendError(
            session,
            "AUTH_REQUIRED",
            "The client sent a call before authenticating.",
            "Update the offhand MCP client.",
          );
          return;
        }
        this.enqueueCall(session, message as unknown as CallMessage);
        return;
      default:
        this.log("warn", `Ignoring unknown bridge message type "${message.type}".`);
    }
  }

  private handleHello(session: Session, message: HelloMessage): void {
    if (session.authTimer) {
      clearTimeout(session.authTimer);
      session.authTimer = null;
    }

    if (message.protocol !== PANEL_PROTOCOL_VERSION) {
      this.log(
        "warn",
        `A client speaks protocol ${message.protocol}; this panel speaks ${PANEL_PROTOCOL_VERSION}.`,
      );
      this.sendError(
        session,
        "PROTOCOL_MISMATCH",
        `Panel protocol ${PANEL_PROTOCOL_VERSION}, client protocol ${message.protocol}.`,
        "Update the offhand panel and the offhand MCP server to the same version.",
      );
      this.dropSession(session, 4004, "PROTOCOL_MISMATCH");
      return;
    }

    if (!this.token || message.token !== this.token) {
      this.log("warn", "Rejected a client with the wrong bridge token.");
      this.sendError(
        session,
        "AUTH_FAILED",
        "The bridge token did not match.",
        `Both sides read the same token file (${this.configPath()}). Delete it and reconnect to re-pair.`,
      );
      this.dropSession(session, 4003, "AUTH_FAILED");
      return;
    }

    session.authed = true;
    session.lastSeen = Date.now();
    this.serverPath =
      typeof message.clientPath === "string" && message.clientPath ? message.clientPath : null;
    this.send(session, {
      type: "welcome",
      protocol: PANEL_PROTOCOL_VERSION,
      panelVersion: PANEL_VERSION,
      ae: this.ae,
      settings: { ...this.settings },
    });

    session.pingTimer = setInterval(() => {
      if (Date.now() - session.lastSeen > PONG_TIMEOUT_MS) {
        this.log("warn", "A client stopped answering pings; closing it.");
        this.dropSession(session, 4002, "PONG_TIMEOUT");
        return;
      }
      this.send(session, { type: "ping", ts: Date.now() });
    }, PING_INTERVAL_MS);

    this.log(
      "info",
      `Client connected${message.clientVersion ? ` (${message.clientVersion})` : ""}.`,
    );
    this.setState("ready");
    // Warm the snapshot in the background so the panel shows the open comp.
    this.enqueueSnapshot();
  }

  private enqueueCall(session: Session, message: CallMessage): void {
    const timeoutMs = Math.min(
      Math.max(Number(message.timeoutMs) || DEFAULT_CALL_TIMEOUT_MS, MIN_CALL_TIMEOUT_MS),
      MAX_CALL_TIMEOUT_MS,
    );
    const deadline =
      typeof message.deadline === "number" && message.deadline > 0
        ? Math.min(message.deadline, Date.now() + timeoutMs)
        : Date.now() + timeoutMs;

    const job: Job = {
      session,
      id: String(message.id ?? ""),
      tool: String(message.tool ?? ""),
      args:
        typeof message.args === "object" && message.args !== null
          ? message.args
          : {},
      deadline,
    };

    // The security gate lives here, not in the host: raw ExtendScript never
    // reaches After Effects unless the person at the panel opted in. A `batch`
    // is checked as a whole, so nested `execute` cannot slip past the gate.
    const blocked = this.blockedBySecurityGate(job);
    if (blocked) {
      this.log("warn", `Blocked a \`${job.tool}\` call: raw scripts are disabled.`);
      this.deliver(job, {
        type: "result",
        id: job.id,
        ok: false,
        error: blocked,
        ms: 0,
      });
      return;
    }

    this.queue.push(job);
    this.pump();
  }

  /** Returns the refusal payload, or null when the call may run. */
  private blockedBySecurityGate(job: Job): SerializedError | null {
    if (this.settings.allowRawScripts) return null;

    let needsRawScripts = job.tool === "execute";

    if (job.tool === "batch") {
      const calls = (job.args as { calls?: unknown }).calls;
      if (Array.isArray(calls)) {
        needsRawScripts = calls.some(
          (call) =>
            typeof call === "object" &&
            call !== null &&
            (call as { tool?: unknown }).tool === "execute",
        );
      }
    }

    if (!needsRawScripts) return null;

    return {
      code: "EXECUTE_DISABLED",
      message:
        job.tool === "batch"
          ? "This batch contains an `execute` call, and raw ExtendScript is disabled in the offhand panel."
          : "Raw ExtendScript is disabled in the offhand panel.",
      hint: 'Typed tools cover most tasks. To run raw scripts, enable "Allow raw scripts" in the offhand panel and retry.',
    };
  }

  private enqueueSnapshot(): void {
    this.queue.push({
      session: {
        socket: null as unknown as WsSocket,
        authed: false,
        authTimer: null,
        pingTimer: null,
        lastSeen: 0,
      },
      id: "",
      tool: "status",
      args: {},
      deadline: Date.now() + DEFAULT_CALL_TIMEOUT_MS,
    });
    this.pump();
  }

  private pump(): void {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    void this.run(job);
  }

  private async run(job: Job): Promise<void> {
    const started = Date.now();
    try {
      const remaining = job.deadline - Date.now();
      if (remaining <= 0) throw new DeadlineExceeded();
      const data = await withDeadline(callHost(job.tool, job.args), remaining);

      if (job.tool === "status" && data && typeof data === "object") {
        this.ae = data as AeSnapshot;
      }
      if (job.id) {
        this.deliver(job, {
          type: "result",
          id: job.id,
          ok: true,
          data,
          ms: Date.now() - started,
        });
      }
    } catch (error) {
      const timedOut = error instanceof DeadlineExceeded;
      const payload = this.errorPayload(error);
      if (timedOut) {
        this.log(
          "warn",
          `"${job.tool}" timed out after ${Date.now() - started}ms — After Effects may be waiting on a modal dialog.`,
        );
      } else if (job.id) {
        this.log("warn", `"${job.tool}" failed: ${payload.message}`);
      }
      if (job.id) {
        this.deliver(job, {
          type: "result",
          id: job.id,
          ok: false,
          error: payload,
          ms: Date.now() - started,
        });
      }
    } finally {
      this.busy = false;
      if (this.queue.length) this.pump();
    }
  }

  private errorPayload(error: unknown): SerializedError {
    if (error instanceof DeadlineExceeded) {
      return {
        code: "AE_BUSY",
        message:
          "After Effects did not answer before the deadline, so the call was abandoned.",
        hint: "A modal dialog in After Effects may be blocking the host. Dismiss it, then retry.",
      };
    }
    if (error instanceof HostCallError) {
      return {
        code: error.code,
        message: error.message,
        hint: error.hint,
      };
    }
    return { code: "HOST_ERROR", message: messageOf(error) };
  }

  private deliver(job: Job, message: PanelToClientMessage): void {
    if (!job.session.authed) return;
    this.send(job.session, message);
  }

  private send(session: Session, message: PanelToClientMessage): void {
    try {
      session.socket.send(JSON.stringify(message));
    } catch {
      this.endSession(session);
    }
  }

  private sendError(
    session: Session,
    code: string,
    message: string,
    hint?: string,
  ): void {
    this.send(session, { type: "error", code, message, hint });
  }

  private dropSession(session: Session, code: number, reason: string): void {
    try {
      session.socket.close(code, reason);
    } catch {
      session.socket.terminate();
    }
    this.endSession(session);
  }

  private endSession(session: Session): void {
    if (!this.sessions.delete(session)) return;
    if (session.authTimer) clearTimeout(session.authTimer);
    if (session.pingTimer) clearInterval(session.pingTimer);
    session.authTimer = null;
    session.pingTimer = null;

    if (session.authed) {
      this.log("info", "Client disconnected.");
      const stillAuthed = [...this.sessions].some((item) => item.authed);
      if (!stillAuthed && this.wss) this.setState("listening");
    }
    this.emitStatus();
  }

  private fail(message: string): void {
    this.lastError = message;
    this.state = "degraded";
    this.log("error", message);
    this.emitStatus();
  }

  private setState(state: PanelState): void {
    if (this.state === state) {
      this.emitStatus();
      return;
    }
    this.state = state;
    this.emitStatus();
  }

  private emitStatus(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // A broken listener must not take the bridge down.
      }
    }
  }

  private log(level: PanelLogLevel, message: string): void {
    this.logId += 1;
    const entry: PanelLog = {
      id: this.logId,
      at: Date.now(),
      level,
      message,
    };
    this.logs = [...this.logs, entry].slice(-MAX_LOG_ENTRIES);
    if (level === "error") this.lastError = message;
    for (const listener of this.logListeners) {
      try {
        listener([...this.logs]);
      } catch {
        // Ignore listener errors.
      }
    }
  }
}

export const bridge = new PanelBridge();
export type { BridgeConfig };
