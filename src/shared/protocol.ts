import type { SerializedError } from './errors.js';

export interface AeSnapshot {
  version: string;
  project: {
    name: string;
    path: string | null;
    dirty: boolean;
  } | null;
  comp: {
    id: number;
    name: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
    time: number;
    layers: number;
  } | null;
}

/**
 * Bridge lifecycle. Every transition has a deadline; nothing is allowed to
 * hang silently in a boolean.
 *
 * idle         no bridge.json yet (panel never published an address)
 * connecting   TCP/WebSocket handshake in flight
 * handshaking  socket is open, waiting for the panel's welcome
 * ready        authenticated and able to take calls
 * degraded     the last attempt failed; a retry is scheduled
 */
export type BridgeState = 'idle' | 'connecting' | 'handshaking' | 'ready' | 'degraded';

export type BridgeDiagnosisCode =
  | 'PANEL_NOT_RUNNING'
  | 'BRIDGE_STALE'
  | 'TOKEN_MISMATCH'
  | 'VERSION_MISMATCH'
  | 'AE_BUSY'
  | 'BRIDGE_OFFLINE';

export interface BridgeDiagnosis {
  code: BridgeDiagnosisCode;
  message: string;
  hint: string;
}

/** Sent by the MCP server (client) right after the socket opens. */
export interface HelloMessage {
  type: 'hello';
  protocol: number;
  token: string;
  clientVersion: string;
}

/** Panel-owned preferences, observable by the server but not writable by it. */
export interface PanelSettings {
  /** Gates the `execute` tool. Off by default. */
  allowRawScripts: boolean;
}

/** Sent by the panel once the hello is accepted. */
export interface WelcomeMessage {
  type: 'welcome';
  protocol: number;
  panelVersion: string;
  ae: AeSnapshot | null;
  settings?: PanelSettings;
}

/** MCP server -> panel. `deadline` is an absolute epoch-ms timestamp. */
export interface CallMessage {
  type: 'call';
  id: string;
  tool: string;
  args: unknown;
  timeoutMs: number;
  deadline: number;
}

/** Panel -> MCP server. */
export interface ResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  data?: unknown;
  error?: SerializedError;
  ms?: number;
}

export interface PingMessage {
  type: 'ping';
  ts: number;
}

export interface PongMessage {
  type: 'pong';
  ts: number;
}

export interface BridgeEventMessage {
  type: 'event';
  event: string;
  data?: unknown;
}

export interface BridgeErrorMessage {
  type: 'error';
  code: string;
  message: string;
  hint?: string;
}

export type ClientToPanelMessage = HelloMessage | CallMessage | PingMessage | PongMessage;

export type PanelToClientMessage =
  | WelcomeMessage
  | ResultMessage
  | PingMessage
  | PongMessage
  | BridgeEventMessage
  | BridgeErrorMessage;

/** Panel -> client liveness signal, used by `status`. */
export interface BridgeStatus {
  state: BridgeState;
  online: boolean;
  host: string | null;
  port: number | null;
  panelVersion: string | null;
  ae: AeSnapshot | null;
  connectedAt: string | null;
  attempts: number;
  lastError: string | null;
  diagnosis: BridgeDiagnosis | null;
  /** Mirrors the panel's `Allow raw scripts` toggle. */
  allowRawScripts: boolean;
}
