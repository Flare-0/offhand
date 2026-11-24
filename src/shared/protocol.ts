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

export interface HelloMessage {
  type: 'hello';
  protocol: number;
  token: string;
  panelVersion: string;
  ae?: AeSnapshot | null;
}

export interface WelcomeMessage {
  type: 'welcome';
  protocol: number;
  serverVersion: string;
}

export interface CallMessage {
  type: 'call';
  id: string;
  tool: string;
  args: unknown;
  timeoutMs?: number;
}

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

export interface AuthErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type ServerToPanelMessage =
  | WelcomeMessage
  | CallMessage
  | PingMessage
  | PongMessage
  | AuthErrorMessage;

export type PanelToServerMessage =
  | HelloMessage
  | ResultMessage
  | PingMessage
  | PongMessage
  | BridgeEventMessage;

export interface BridgeStatus {
  online: boolean;
  host: string;
  port: number | null;
  panelVersion: string | null;
  ae: AeSnapshot | null;
  connectedAt: string | null;
}
