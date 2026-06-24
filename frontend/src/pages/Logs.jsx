import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";

const LEVELS = ["all", "info", "warn", "error", "debug"];

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState("all");
  const [paused, setPaused] = useState(false);
  const tref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/logs?limit=200");
      setLogs(r.data || []);
    } catch (e) {
      console.error("logs load failed", e);
    }
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    load();
    tref.current = setInterval(load, 3000);
    return () => clearInterval(tref.current);
  }, [paused, load]);

  const filtered = level === "all" ? logs : logs.filter((l) => l.level === level);

  return (
    <div data-testid="logs-page">
      <PageHeader
        title="System logs"
        subtitle="Stream events & telemetry"
        testId="logs-header"
        right={
          <div className="flex items-center gap-1.5">
            {LEVELS.map((l) => (
              <button
                key={l}
                data-testid={`log-filter-${l}`}
                onClick={() => setLevel(l)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  level === l ? "bg-[var(--primary)] text-white" : "bg-[var(--surface)] text-[var(--text-2)] border border-[var(--border)] hover:border-[var(--primary)]"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
            <button
              data-testid="logs-pause"
              onClick={() => setPaused((p) => !p)}
              className={`ml-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                paused ? "bg-[var(--warn-soft)] text-[#B45309] border border-[#FDE68A]" : "bg-[var(--surface)] text-[var(--text-2)] border border-[var(--border)] hover:border-[var(--primary)]"
              }`}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        }
      />

      <div className="p-8">
        <div className="terminal p-5 h-[calc(100vh-220px)] overflow-y-auto" data-testid="logs-terminal">
          {filtered.map((l, i) => (
            <div key={`${l.ts}-${l.source}-${l.stream}-${i}`} className="whitespace-pre-wrap">
              <span className="log-time">[{new Date(l.ts).toLocaleTimeString()}]</span>{" "}
              <span className={`log-${l.level} uppercase`}>{l.level.padEnd(5)}</span>{" "}
              <span className="log-source">{l.source}/{l.stream}</span>{" "}
              <span>{l.message}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-slate-400">No log entries.</div>}
        </div>
      </div>
    </div>
  );
}
