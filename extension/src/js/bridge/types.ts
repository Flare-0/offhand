// Panel-side copy of the wire protocol.
//
// The panel is a separate tsconfig/build root from the MCP server, so it cannot
// import the repo-root `src/shared/protocol.ts`. These types are deliberately
// duplicated — keep them in sync with that file. The single source of truth is
// the `PROTOCOL_VERSION` constant: both sides refuse to talk across a mismatch.

export const PANEL_PROTOCOL_VERSION = 2;

export type AeSnapshot = {
  version: string;
  project: {
    name: string;
    path: string | null;
    dirty: boolean;
    items?: number;
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
  selection?: {
    items: { id: number; name: string; type: string }[];
    layers: { uid: string; name: string }[];
  };
};

export type BridgeState =
  | "idle"
  | "connecting"
  | "handshaking"
  | "ready"
  | "degraded";

export type BridgeDiagnosisCode =
  | "PANEL_NOT_RUNNING"
  | "BRIDGE_STALE"
  | "TOKEN_MISMATCH"
  | "VERSION_MISMATCH"
  | "AE_BUSY"
  | "BRIDGE_OFFLINE";

export type BridgeDiagnosis = {
  code: BridgeDiagnosisCode;
  message: string;
  hint?: string;
};

export type SerializedError = {
  code: string;
  message: string;
  hint?: string;
};

/**
 * Panel-owned preferences. `allowRawScripts` gates the `execute` tool: when it
 * is off the panel rejects raw ExtendScript before it ever reaches the host.
 */
export type PanelSettings = {
  allowRawScripts: boolean;
};

/** MCP server -> panel, first message on every socket. */
export type HelloMessage = {
  type: "hello";
  protocol: number;
  token: string;
  clientVersion?: string;
  clientPath?: string;
};

/** Panel -> MCP server, sent once the hello is accepted. */
export type WelcomeMessage = {
  type: "welcome";
  protocol: number;
  panelVersion: string;
  ae: AeSnapshot | null;
  settings: PanelSettings;
};

export type CallMessage = {
  type: "call";
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Relative budget in ms. `deadline` is authoritative. */
  timeoutMs: number;
  /** Absolute epoch ms after which the panel must answer with AE_BUSY. */
  deadline: number;
};

export type ResultMessage = {
  type: "result";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: SerializedError;
  ms?: number;
};

export type PingMessage = { type: "ping"; ts: number };
export type PongMessage = { type: "pong"; ts: number };

export type BridgeEventMessage = {
  type: "event";
  event: string;
  data?: unknown;
};

export type BridgeErrorMessage = {
  type: "error";
  code: string;
  message: string;
  hint?: string;
};

export type ClientToPanelMessage =
  | HelloMessage
  | CallMessage
  | PingMessage
  | PongMessage;

export type PanelToClientMessage =
  | WelcomeMessage
  | ResultMessage
  | PingMessage
  | PongMessage
  | BridgeEventMessage
  | BridgeErrorMessage;

/** Contents of `%APPDATA%/offhand/bridge.json`, written by the panel. */
export type BridgeConfig = {
  version: 2;
  protocol: number;
  host: string;
  port: number;
  token: string;
  pid: number;
  panelVersion: string;
  startedAt: number;
};
