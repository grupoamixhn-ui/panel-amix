import { useEffect, useRef, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";

const LEVELS = ["all", "info", "warn", "error", "debug"];

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState("all");
  const [paused, setPaused] = useState(false);
  const tref = useRef(null);

  useEffect(() => {
    const load = async () => {
      if (paused) return;
      try {
        const r = await api.get("/logs?limit=200");
        setLogs(r.data || []);
      } catch { /* ignore */ }
    };
    load();
    tref.current = setInterval(load, 3000);
    return () => clearInterval(tref.current);
  }, [paused]);

  const filtered = level === "all" ? logs : logs.filter((l) => l.level === level);

  return (
    <div data-testid="logs-page">
      <PageHeader
        title="System Logs"
        subtitle="STREAM EVENTS & TELEMETRY"
        testId="logs-header"
        right={
          <div className="flex items-center gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                data-testid={`log-filter-${l}`}
                onClick={() => setLevel(l)}
                className={`px-3 py-1 text-xs border mono uppercase ${level === l ? "border-[var(--primary)] text-white" : "border-[var(--border)] text-[var(--muted)]"}`}
              >
                {l}
              </button>
            ))}
            <button
              data-testid="logs-pause"
              onClick={() => setPaused((p) => !p)}
              className={`px-3 py-1 text-xs border mono uppercase ${paused ? "border-[var(--warn)] text-[var(--warn)]" : "border-[var(--border)] text-[var(--muted)]"}`}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        }
      />

      <div className="p-8">
        <div className="terminal p-4 h-[calc(100vh-220px)] overflow-y-auto" data-testid="logs-terminal">
          {filtered.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">
              <span className="log-time">[{new Date(l.ts).toLocaleTimeString()}]</span>{" "}
              <span className={`log-${l.level} uppercase`}>{l.level.padEnd(5)}</span>{" "}
              <span className="log-source">{l.source}/{l.stream}</span>{" "}
              <span>{l.message}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-[var(--muted)]">No log entries.</div>}
        </div>
      </div>
    </div>
  );
}
