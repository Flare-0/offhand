import { useEffect, useMemo, useState } from "react";
import { bridge } from "../bridge/server";
import type { PanelLog, PanelStatus } from "../bridge/server";
import { PANEL_VERSION } from "../bridge/config";
import "./main.scss";

const STATE_LABEL: Record<PanelStatus["state"], string> = {
  idle: "idle",
  listening: "listening",
  ready: "connected",
  degraded: "error",
};

const STATE_HINT: Record<PanelStatus["state"], string> = {
  idle: "Starting the bridge…",
  listening: "Waiting for an MCP client…",
  ready: "An MCP client is connected. Tools are available.",
  degraded: "The bridge hit an error. Open Debug for details.",
};

const copyText = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
};

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour12: false });

function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className={`oh-toggle${props.checked ? " oh-toggle--on" : ""}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="oh-toggle-knob" />
    </button>
  );
}

export function App() {
  const [status, setStatus] = useState<PanelStatus>(() => bridge.status());
  const [logs, setLogs] = useState<PanelLog[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const offStatus = bridge.subscribe(setStatus);
    const offLog = bridge.onLog(setLogs);
    void bridge.start();
    return () => {
      offStatus();
      offLog();
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const state = status.state;
  const ae = status.ae;
  const project = ae?.project ?? null;
  const comp = ae?.comp ?? null;
  const configPath = bridge.configPath();
  const endpoint = status.port ? `ws://${status.host}:${status.port}` : "not listening";

  const mcpConfig = useMemo(() => {
    const command = status.serverPath
      ? ["node", status.serverPath]
      : ["node", "<absolute path to offhand>/dist/cli.js"];
    return JSON.stringify(
      {
        mcp: {
          offhand: {
            type: "local",
            command,
            enabled: true,
          },
        },
      },
      null,
      2,
    );
  }, [status.serverPath]);

  const reconnect = async () => {
    setReconnecting(true);
    try {
      await bridge.restart();
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div className="oh-app">
      <header className="oh-head">
        <div>
          <div className="oh-title">offhand</div>
          <div className="oh-sub">After Effects bridge</div>
        </div>
        <span className={`oh-chip oh-chip--${state}`}>{STATE_LABEL[state]}</span>
      </header>

      <details className="oh-debug">
        <summary className="oh-debug-summary">
          <span className="oh-debug-title">Debug</span>
          <span className="oh-debug-caret" aria-hidden="true">
            ›
          </span>
        </summary>

        <div className="oh-debug-body">
          <div className="oh-debug-section">
            <div className="oh-row">
              <span>Endpoint</span>
              <code>{endpoint}</code>
            </div>
            <div className="oh-row">
              <span>MCP clients</span>
              <span>{status.clients > 0 ? `${status.clients} connected` : "none"}</span>
            </div>
            <div className="oh-row">
              <span>Panel</span>
              <span>v{status.panelVersion || PANEL_VERSION}</span>
            </div>
            <div className="oh-row">
              <span>Server</span>
              <code title={status.serverPath ?? undefined}>
                {status.serverPath ?? "waiting for an MCP client"}
              </code>
            </div>
            <div className="oh-row oh-row--toggle">
              <span>Allow raw scripts</span>
              <Toggle
                checked={status.settings.allowRawScripts}
                onChange={(next) => bridge.setAllowRawScripts(next)}
                label="Allow raw scripts"
              />
            </div>
            {status.settings.allowRawScripts ? (
              <div className="oh-warn">
                Raw `execute` scripts are enabled. Only keep this on while you trust every
                connected agent.
              </div>
            ) : (
              <div className="oh-muted oh-muted--tight">
                `execute` and batch calls containing it are rejected while this is off.
              </div>
            )}
          </div>

          <div className="oh-debug-section">
            <div className="oh-actions">
              <button type="button" disabled={reconnecting} onClick={() => void reconnect()}>
                {reconnecting ? "Reconnecting…" : "Reconnect"}
              </button>
              <button
                type="button"
                disabled={!status.serverPath}
                title={
                  status.serverPath
                    ? "Copy a working local MCP config."
                    : "Connect an MCP client once so the panel learns the server path."
                }
                onClick={() => {
                  void copyText(mcpConfig).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy MCP config"}
              </button>
            </div>
            <div className="oh-path" title={configPath}>
              {configPath}
            </div>
          </div>
        </div>
      </details>

      <section className="oh-card">
        <div className="oh-card-title">Status</div>
        <div className="oh-status-line">
          <span className="oh-status-hint">{STATE_HINT[state]}</span>
        </div>
        {status.lastError ? <div className="oh-error">{status.lastError}</div> : null}

        <div className="oh-status-grid">
          <div className="oh-row">
            <span>MCP client</span>
            <span>{status.clients > 0 ? `${status.clients} connected` : "none"}</span>
          </div>
          <div className="oh-row">
            <span>After Effects</span>
            <span>{ae ? ae.version : "waiting for a snapshot…"}</span>
          </div>
          <div className="oh-row">
            <span>Project</span>
            <span title={project?.path ?? undefined}>
              {project ? `${project.name}${project.dirty ? " *" : ""}` : "no project"}
            </span>
          </div>
          <div className="oh-row">
            <span>Comp</span>
            <span>{comp ? comp.name : "none open"}</span>
          </div>
          <div className="oh-row">
            <span>Size</span>
            <span>{comp ? `${comp.width}×${comp.height} · ${comp.fps.toFixed(2)} fps` : "—"}</span>
          </div>
          <div className="oh-row">
            <span>Layers</span>
            <span>{comp ? comp.layers : "—"}</span>
          </div>
          <div className="oh-row">
            <span>Time</span>
            <span>
              {comp ? `${comp.time.toFixed(2)} / ${comp.duration.toFixed(2)} s` : "—"}
            </span>
          </div>
        </div>
      </section>

      <section className="oh-card oh-card--grow">
        <div className="oh-card-title">Log</div>
        <div className="oh-log">
          {logs.length === 0 ? (
            <div className="oh-muted">No events yet.</div>
          ) : (
            logs
              .slice(-40)
              .reverse()
              .map((entry) => (
                <div key={entry.id} className={`oh-log-line oh-log-line--${entry.level}`}>
                  <span className="oh-log-time">{clock(entry.at)}</span>
                  <span>{entry.message}</span>
                </div>
              ))
          )}
        </div>
      </section>
    </div>
  );
}

export default App;
