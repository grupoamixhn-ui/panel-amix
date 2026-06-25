import { useCallback, useEffect, useMemo, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "./PageHeader";
import OutputsModal from "./OutputsModal";
import StreamClientsModal from "./StreamClientsModal";
import StreamLiveMonitor from "./StreamLiveMonitor";
import PushTargetsModal from "./PushTargetsModal";
import {
  Search, Activity, Send, Users, Share2, Wifi, Clock, RotateCw, Tv2,
} from "lucide-react";

function StatusBadge({ s }) {
  if (s.alive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--live-soft)] border border-[#BBF7D0] text-[#15803D] text-[10px] font-bold uppercase tracking-wider">
        <span className="dot dot-live" /> Live
      </span>
    );
  }
  if (s.status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-[10px] font-bold uppercase tracking-wider">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] text-[10px] font-bold uppercase tracking-wider">
      Idle
    </span>
  );
}

function SourceBadge({ s }) {
  const url = s.inputs?.[0]?.url || "";
  const isPub = url.startsWith("publish://");
  if (isPub && s.publisher_ip) {
    const proto = (s.publisher_proto || "").toUpperCase();
    const cls = proto === "RTMP"
      ? "bg-orange-50 text-orange-700 border-orange-200"
      : proto === "SRT"
      ? "bg-purple-50 text-purple-700 border-purple-200"
      : "bg-slate-50 text-slate-700 border-slate-200";
    return (
      <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[9px] font-semibold tracking-wider ${cls}`}>
        {proto || "PUSH"} · {s.publisher_ip}
      </span>
    );
  }
  if (isPub) {
    return <span className="text-[10px] italic text-[var(--muted)]">waiting for publisher</span>;
  }
  if (url) {
    const proto = url.startsWith("hls") ? "HLS" : url.startsWith("rtmp") ? "RTMP" : url.startsWith("srt") ? "SRT" : "URL";
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border bg-slate-50 text-slate-700 border-slate-200 text-[9px] font-semibold tracking-wider">
        {proto} source
      </span>
    );
  }
  return null;
}

function StreamCard({ s, onMonitor, onPush, onOutputs, onClients, onReset, resetting }) {
  const isLive = s.alive;
  return (
    <div
      className={`cell p-5 flex flex-col gap-3 transition-all hover:shadow-[var(--shadow-lg)] hover:-translate-y-0.5 ${isLive ? "ring-1 ring-[var(--live)]/20" : ""}`}
      data-testid={`stream-card-${s.name}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isLive ? "bg-[var(--live-soft)]" : "bg-[var(--surface-2)]"}`}>
          <Tv2 className={`w-5 h-5 ${isLive ? "text-[var(--live)]" : "text-[var(--muted)]"}`} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="font-semibold text-base truncate" title={s.name}>{s.name}</div>
            <StatusBadge s={s} />
          </div>
          {s.title && <div className="text-xs text-[var(--muted)] truncate">{s.title}</div>}
          <div className="mt-1.5"><SourceBadge s={s} /></div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 mt-1">
        <div className="px-3 py-2 rounded-lg bg-[var(--surface-2)] text-center">
          <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-[var(--muted)] mb-0.5">
            <Users className="w-2.5 h-2.5" /> Viewers
          </div>
          <div className="text-sm font-bold mono" data-testid={`card-viewers-${s.name}`}>{(s.clients || 0).toLocaleString()}</div>
        </div>
        <div className="px-3 py-2 rounded-lg bg-[var(--surface-2)] text-center">
          <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-[var(--muted)] mb-0.5">
            <Wifi className="w-2.5 h-2.5" /> Bitrate
          </div>
          <div className="text-sm font-bold mono">{fmtBitrate(s.bitrate || 0)}</div>
        </div>
        <div className="px-3 py-2 rounded-lg bg-[var(--surface-2)] text-center">
          <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-[var(--muted)] mb-0.5">
            <Clock className="w-2.5 h-2.5" /> Uptime
          </div>
          <div className="text-sm font-bold mono text-[var(--text-2)]">{fmtUptime(s.uptime || 0)}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 mt-1">
        <button
          onClick={onMonitor}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition flex items-center justify-center gap-1.5"
          data-testid={`card-monitor-${s.name}`}
        >
          <Activity className="w-3.5 h-3.5" /> Live monitor
        </button>
        <button
          onClick={onPush}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition flex items-center justify-center gap-1.5"
          data-testid={`card-push-${s.name}`}
        >
          <Send className="w-3.5 h-3.5" /> Social push
        </button>
        <button
          onClick={onOutputs}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition flex items-center justify-center gap-1.5"
          data-testid={`card-outputs-${s.name}`}
        >
          <Share2 className="w-3.5 h-3.5" /> Playback URLs
        </button>
        <button
          onClick={onClients}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition flex items-center justify-center gap-1.5"
          data-testid={`card-clients-${s.name}`}
        >
          <Users className="w-3.5 h-3.5" /> Connected ({s.clients || 0})
        </button>
      </div>

      <button
        onClick={onReset}
        disabled={resetting}
        className="mt-1 px-3 py-2 text-[11px] font-medium rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition flex items-center justify-center gap-1.5"
        title="Reset · kick viewers and reconnect source"
        data-testid={`card-reset-${s.name}`}
      >
        <RotateCw className={`w-3 h-3 ${resetting ? "animate-spin" : ""}`} />
        {resetting ? "Resetting…" : "Reset stream"}
      </button>
    </div>
  );
}

export default function ClientStreamsView() {
  const [streams, setStreams] = useState([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all|live|idle|error
  const [outputsFor, setOutputsFor] = useState(null);
  const [clientsFor, setClientsFor] = useState(null);
  const [monitorFor, setMonitorFor] = useState(null);
  const [pushFor, setPushFor] = useState(null);
  const [resetting, setResetting] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await api.get("/streams");
      setStreams(r.data || []);
    } catch (e) {
      console.error("streams load failed", e);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const reset = async (name) => {
    if (!window.confirm(`Reset "${name}"?\n\nThis disconnects current viewers and forces the source to reconnect.`)) return;
    setResetting((r) => ({ ...r, [name]: true }));
    try {
      await api.post(`/streams/${name}/reset`);
      setTimeout(load, 1200);
    } catch (e) {
      window.alert(`Failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setResetting((r) => { const n = { ...r }; delete n[name]; return n; });
    }
  };

  const totals = useMemo(() => {
    const live = streams.filter((s) => s.alive).length;
    const viewers = streams.reduce((a, s) => a + (s.clients || 0), 0);
    const bw = streams.reduce((a, s) => a + (s.bitrate || 0), 0);
    const error = streams.filter((s) => s.status === "error").length;
    return { live, viewers, bw, error, total: streams.length };
  }, [streams]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return streams.filter((s) => {
      if (statusFilter === "live" && !s.alive) return false;
      if (statusFilter === "idle" && (s.alive || s.status === "error")) return false;
      if (statusFilter === "error" && s.status !== "error") return false;
      if (!term) return true;
      return s.name.toLowerCase().includes(term) || (s.title || "").toLowerCase().includes(term);
    });
  }, [streams, q, statusFilter]);

  return (
    <div data-testid="streams-page">
      <PageHeader
        title="My streams"
        subtitle="Live broadcast control center"
        testId="streams-header"
        right={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--live-soft)] border border-[#BBF7D0]">
            <span className="dot dot-live" />
            <span className="text-xs font-semibold text-[#15803D]">{totals.live} live</span>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-5">
        {/* Top KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="cell p-4">
            <div className="label mb-1">Total streams</div>
            <div className="text-2xl font-bold mono">{totals.total}</div>
            <div className="text-[11px] text-[var(--muted)]">{totals.live} live · {totals.error} error</div>
          </div>
          <div className="cell p-4">
            <div className="label mb-1">Active viewers</div>
            <div className="text-2xl font-bold mono">{totals.viewers.toLocaleString()}</div>
            <div className="text-[11px] text-[var(--muted)]">across all your streams</div>
          </div>
          <div className="cell p-4">
            <div className="label mb-1">Output bandwidth</div>
            <div className="text-2xl font-bold mono">{fmtBitrate(totals.bw)}</div>
            <div className="text-[11px] text-[var(--muted)]">aggregate</div>
          </div>
          <div className="cell p-4">
            <div className="label mb-1">Status</div>
            <div className="text-2xl font-bold mono text-[var(--live)]">{totals.total > 0 ? Math.round((totals.live / totals.total) * 100) : 0}%</div>
            <div className="text-[11px] text-[var(--muted)]">streams online</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              data-testid="streams-search"
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search streams…"
              className="w-full pl-10 pr-3 py-2.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {[
              { v: "all", lbl: `All (${totals.total})` },
              { v: "live", lbl: `Live (${totals.live})` },
              { v: "idle", lbl: "Idle" },
              { v: "error", lbl: `Error (${totals.error})` },
            ].map(({ v, lbl }) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                data-testid={`filter-${v}`}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-lg border transition ${
                  statusFilter === v
                    ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                    : "border-[var(--border)] hover:border-[var(--primary)]"
                }`}
              >{lbl}</button>
            ))}
          </div>
          <div className="text-xs text-[var(--muted)] mono ml-auto">{filtered.length} shown</div>
        </div>

        {/* Cards grid */}
        {filtered.length === 0 ? (
          <div className="cell p-10 text-center text-sm text-[var(--muted)]" data-testid="empty-state">
            {streams.length === 0
              ? "No streams have been assigned to your account yet. Contact your provider to get started."
              : "No streams match the current filter."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="streams-grid">
            {filtered.map((s) => (
              <StreamCard
                key={s.name}
                s={s}
                onMonitor={() => setMonitorFor(s.name)}
                onPush={() => setPushFor(s.name)}
                onOutputs={() => setOutputsFor(s.name)}
                onClients={() => setClientsFor(s.name)}
                onReset={() => reset(s.name)}
                resetting={!!resetting[s.name]}
              />
            ))}
          </div>
        )}
      </div>

      {outputsFor && (<OutputsModal streamName={outputsFor} onClose={() => setOutputsFor(null)} />)}
      {clientsFor && (<StreamClientsModal streamName={clientsFor} onClose={() => setClientsFor(null)} />)}
      {monitorFor && (<StreamLiveMonitor streamName={monitorFor} onClose={() => setMonitorFor(null)} />)}
      {pushFor && (<PushTargetsModal streamName={pushFor} onClose={() => setPushFor(null)} />)}
    </div>
  );
}
