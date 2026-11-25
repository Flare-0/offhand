import { useEffect, useMemo, useState } from "react";
import { bridge } from "../bridge/server";
import type { PanelLog, PanelStatus } from "../bridge/server";
import { PANEL_VERSION } from "../bridge/config";
import "./main.scss";

const MCP_CONFIG = JSON.stringify(
  {
    mcp: {
      offhand: {
        type: "local",
        command: ["npx", "-y", "offhand-mcp"],
        enabled: true,
      },
    },
  },
  null,
  2,
);

const STATE_LABEL: Record<PanelStatus["state"], string> = {
  idle: "idle",
  listening: "listening",
  ready: "connected",
  degraded: "error",
};

const STATE_HINT: Record<PanelStatus["state"], string> = {
  idle: "Starting the bridge…",
  listening:
    "Waiting for an MCP client. Add offhand to your MCP config, then start a chat.",
  ready: "An MCP client is connected. Tools are available.",
  degraded: "The bridge could not start. Fix the error above, then press Reconnect.",
};

const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // CEP's Chromium blocks the async clipboard on file:// pages.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
};

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`oh-toggle${checked ? " oh-toggle--on" : ""}`}
    onClick={() => onChange(!checked)}
  >
    <span className="oh-toggle-knob" />
  </button>
);

export const App = () => {
  const [status, setStatus] = useState<PanelStatus>(() => bridge.status());
  const [logs, setLogs] = useState<PanelLog[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubscribeStatus = bridge.subscribe(setStatus);
    const unsubscribeLog = bridge.onLog(setLogs);
    // Idempotent: StrictMode mounts twice and Reconnect can race this.
    void bridge.start();
    return () => {
      unsubscribeStatus();
      unsubscribeLog();
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const configPath = useMemo(() => bridge.configPath(), []);
  const ae = status.ae;

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
        <span className={`oh-chip oh-chip--${status.state}`}>
          {STATE_LABEL[status.state]}
        </span>
      </header>

      <section className="oh-card">
        <div className="oh-row">
          <span>Endpoint</span>
          <code>
            {status.port ? `ws://${status.host}:${status.port}` : "not listening"}
          </code>
        </div>
        <div className="oh-row">
          <span>Clients</span>
          <span>{status.clients}</span>
        </div>
        <div className="oh-row">
          <span>Panel</span>
          <span>v{status.panelVersion || PANEL_VERSION}</span>
        </div>
        <p className="oh-hint">{STATE_HINT[status.state]}</p>
        {status.lastError && <p className="oh-error">{status.lastError}</p>}
      </section>

      <section className="oh-card">
        <div className="oh-card-title">After Effects</div>
        {ae ? (
          <>
            <div className="oh-row">
              <span>Project</span>
              <span className="oh-value" title={ae.project?.path ?? undefined}>
                {ae.project ? ae.project.name : "no project"}
                {ae.project?.dirty ? " *" : ""}
              </span>
            </div>
            <div className="oh-row">
              <span>Comp</span>
              <span className="oh-value">
                {ae.comp ? ae.comp.name : "none open"}
              </span>
            </div>
            {ae.comp ? (
              <>
                <div className="oh-row">
                  <span>Size</span>
                  <span>
                    {ae.comp.width}×{ae.comp.height} · {ae.comp.fps.toFixed(2)} fps
                  </span>
                </div>
                <div className="oh-row">
                  <span>Layers</span>
                  <span>{ae.comp.layers}</span>
                </div>
                <div className="oh-row">
                  <span>Time</span>
                  <span>
                    {ae.comp.time.toFixed(2)}s / {ae.comp.duration.toFixed(2)}s
                  </span>
                </div>
              </>
            ) : (
              <p className="oh-muted oh-muted--tight">
                Open a composition in After Effects to see it here.
              </p>
            )}
          </>
        ) : (
          <p className="oh-muted">Waiting for a snapshot from After Effects…</p>
        )}
      </section>

      <section className="oh-card">
        <div className="oh-card-title">Permissions</div>
        <div className="oh-row oh-row--toggle">
          <div>
            <span>Allow raw scripts</span>
            <p className="oh-muted oh-muted--tight">
              Lets the agent run arbitrary ExtendScript through the{" "}
              <code>execute</code> tool. Off by default; typed tools keep working
              either way.
            </p>
          </div>
          <Toggle
            label="Allow raw scripts"
            checked={status.settings.allowRawScripts}
            onChange={(next) => bridge.setAllowRawScripts(next)}
          />
        </div>
        {status.settings.allowRawScripts && (
          <p className="oh-warn">
            Raw scripts are enabled. Any connected agent can run code in After
            Effects.
          </p>
        )}
      </section>

      <section className="oh-card oh-card--grow">
        <div className="oh-card-title">Activity</div>
        <div className="oh-log">
          {logs.length === 0 && (
            <p className="oh-muted">Nothing yet. Start the bridge to see events.</p>
          )}
          {logs
            .slice(-40)
            .reverse()
            .map((entry) => (
              <div
                key={entry.id}
                className={`oh-log-line oh-log-line--${entry.level}`}
              >
                <span className="oh-log-time">{clock(entry.at)}</span>
                <span>{entry.message}</span>
              </div>
            ))}
        </div>
      </section>

      <footer className="oh-actions">
        <button onClick={reconnect} disabled={reconnecting}>
          {reconnecting ? "Reconnecting…" : "Reconnect"}
        </button>
        <button onClick={() => copyText(MCP_CONFIG).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy MCP config"}
        </button>
      </footer>

      <p className="oh-path" title={configPath}>
        {configPath || "bridge.json path unavailable"}
      </p>
    </div>
  );
};
