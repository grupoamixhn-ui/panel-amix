import { useCallback, useEffect, useMemo, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "./PageHeader";
import OutputsModal from "./OutputsModal";
import StreamClientsModal from "./StreamClientsModal";
import StreamLiveMonitor from "./StreamLiveMonitor";
import PushTargetsModal from "./PushTargetsModal";
import StreamWizard from "./StreamWizard";
import { useAuth } from "../auth";
import {
  Search, Activity, Send, Users, Share2, RotateCw, Tv2,
  Radio, Zap, Plus, Pencil, Trash2, Wifi,
} from "lucide-react";

function StatusBadge({ s }) {
  if (s.alive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider ring-1 ring-emerald-200">
        <span className="relative flex w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
    );
  }
  if (s.status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-wider ring-1 ring-red-200">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 text-slate-600 text-[10px] font-bold uppercase tracking-wider ring-1 ring-slate-200">
      Idle
    </span>
  );
}

function SourceProto({ s }) {
  const url = s.inputs?.[0]?.url || "";
  const isPub = url.startsWith("publish://");
  const hasFlow = s.alive || (s.bitrate || 0) > 0;
  if (isPub && s.publisher_ip) {
    const proto = (s.publisher_proto || "").toUpperCase();
    return (
      <span className="text-[10px] mono text-slate-500">
        <span className={`${proto === "RTMP" ? "text-orange-600" : proto === "SRT" ? "text-purple-600" : "text-slate-700"} font-bold`}>{proto || "PUSH"}</span>
        <span className="mx-1.5 opacity-50">·</span>{s.publisher_ip}
      </span>
    );
  }
  if (isPub && hasFlow) {
    // Publisher IS connected (we see traffic) but Flussonic didn't expose its IP.
    // Show a positive indicator instead of the misleading "waiting" message.
    return (
      <span className="text-[10px] mono text-slate-500">
        <span className="text-emerald-600 font-bold">PUSH</span>
        <span className="mx-1.5 opacity-50">·</span>publisher connected
      </span>
    );
  }
  if (isPub) return <span className="text-[10px] italic text-slate-400">waiting for publisher</span>;
  if (url) {
    const proto = url.startsWith("hls") ? "HLS" : url.startsWith("rtmp") ? "RTMP" : url.startsWith("srt") ? "SRT" : "URL";
    return <span className="text-[10px] mono text-slate-500"><span className="text-cyan-600 font-bold">{proto}</span> source</span>;
  }
  return null;
}

function ListRow({ s, onMonitor, onPush, onOutputs, onClients, onReset, onEdit, onDelete, resetting, canManage }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3.5 hover:bg-[var(--surface-2)] transition ${s.alive ? "border-l-2 border-emerald-400" : "border-l-2 border-transparent"}`} data-testid={`stream-row-${s.name}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${s.alive ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-[var(--surface-2)]"}`}>
          <Tv2 className={`w-4 h-4 ${s.alive ? "text-emerald-600" : "text-[var(--muted)]"}`} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-[var(--text)] truncate">{s.name}</div>
          <div className="mt-0.5"><SourceProto s={s} /></div>
        </div>
      </div>
      <div className="text-right min-w-[80px]">
        <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">Viewers</div>
        <div className="text-sm mono font-bold">{(s.clients || 0).toLocaleString()}</div>
      </div>
      <div className="text-right min-w-[110px]">
        <div className="text-[9px] uppercase tracking-wider text-[var(--muted)]">Bitrate</div>
        <div className="text-sm mono font-bold">{fmtBitrate(s.bitrate || 0)}</div>
      </div>
      <StatusBadge s={s} />
      <div className="flex items-center gap-1">
        <button onClick={onMonitor} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-emerald-600" title="Monitor" data-testid={`row-monitor-${s.name}`}><Activity className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onPush} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-pink-600" title="Push" data-testid={`row-push-${s.name}`}><Send className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onOutputs} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-cyan-600" title="URLs" data-testid={`row-urls-${s.name}`}><Share2 className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onClients} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-indigo-600" title="Viewers" data-testid={`row-viewers-${s.name}`}><Users className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onReset} disabled={resetting} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-amber-600" title="Reset" data-testid={`row-reset-${s.name}`}><RotateCw className={`w-3.5 h-3.5 mx-auto ${resetting ? "animate-spin" : ""}`} /></button>
        {canManage && (
          <>
            <button onClick={onEdit} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]" title="Edit" data-testid={`row-edit-${s.name}`}><Pencil className="w-3.5 h-3.5 mx-auto" /></button>
            <button onClick={onDelete} className="w-8 h-8 rounded-md text-[var(--muted)] hover:bg-[var(--error-soft)] hover:text-[var(--error)]" title="Delete" data-testid={`row-delete-${s.name}`}><Trash2 className="w-3.5 h-3.5 mx-auto" /></button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ClientStreamsView() {
  const { user } = useAuth();
  const canManage = user?.role !== "client";
  const [streams, setStreams] = useState([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [outputsFor, setOutputsFor] = useState(null);
  const [clientsFor, setClientsFor] = useState(null);
  const [monitorFor, setMonitorFor] = useState(null);
  const [pushFor, setPushFor] = useState(null);
  const [resetting, setResetting] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await api.get("/streams");
      setStreams(r.data || []);
    } catch (e) { console.error("streams load failed", e); }
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

  const handleEdit = async (name) => {
    try {
      const r = await api.get(`/streams/${name}`);
      setEditing(r.data);
    } catch (e) {
      window.alert(`Failed: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete stream "${name}"?\n\nThis is permanent.`)) return;
    try {
      await api.delete(`/streams/${name}`);
      load();
    } catch (e) {
      window.alert(`Failed: ${e?.response?.data?.detail || e.message}`);
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
    const sorted = [...streams].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return (b.clients || 0) - (a.clients || 0);
    });
    return sorted.filter((s) => {
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
        title={canManage ? "Streams" : "My streams"}
        subtitle="Live broadcast control center"
        testId="streams-header"
        right={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-bold text-emerald-700">{totals.live} live</span>
            </div>
            {canManage && (
              <button
                onClick={() => setWizardOpen(true)}
                className="btn btn-primary"
                data-testid="new-stream-button"
              >
                <Plus className="w-3.5 h-3.5" /> New stream
              </button>
            )}
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-5">
        {/* Hero KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="cell p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center">
                <Radio className="w-4.5 h-4.5 text-emerald-600" />
              </div>
              <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">Total streams</div>
            </div>
            <div className="text-4xl font-bold mono">{totals.total}</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">{totals.live} live · {totals.error} error</div>
          </div>

          <div className="cell p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 ring-1 ring-indigo-200 flex items-center justify-center">
                <Users className="w-4.5 h-4.5 text-indigo-600" />
              </div>
              <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">Active viewers</div>
            </div>
            <div className="text-4xl font-bold mono">{totals.viewers.toLocaleString()}</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">across all your streams</div>
          </div>

          <div className="cell p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-cyan-50 ring-1 ring-cyan-200 flex items-center justify-center">
                <Wifi className="w-4.5 h-4.5 text-cyan-600" />
              </div>
              <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">Output bandwidth</div>
            </div>
            <div className="text-4xl font-bold mono">{fmtBitrate(totals.bw)}</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">aggregate live throughput</div>
          </div>

          <div className="cell p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl bg-amber-50 ring-1 ring-amber-200 flex items-center justify-center">
                <Zap className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">Availability</div>
            </div>
            <div className="text-4xl font-bold mono">{totals.total > 0 ? Math.round((totals.live / totals.total) * 100) : 0}<span className="text-2xl text-[var(--muted)]">%</span></div>
            <div className="text-[11px] text-[var(--muted)] mt-1">streams online</div>
          </div>
        </div>

        {/* Toolbar */}
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
                className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition ${
                  statusFilter === v
                    ? "bg-[var(--primary)] text-white"
                    : "bg-white ring-1 ring-[var(--border)] text-[var(--text-2)] hover:border-[var(--primary)]"
                }`}
              >{lbl}</button>
            ))}
          </div>
        </div>

        {/* Streams — list only */}
        {filtered.length === 0 ? (
          <div className="cell p-16 text-center" data-testid="empty-state">
            <Tv2 className="w-12 h-12 text-[var(--muted)] mx-auto mb-3" strokeWidth={1.5} />
            <div className="text-sm text-[var(--text-2)]">
              {streams.length === 0
                ? "No streams have been assigned to your account yet. Contact your provider to get started."
                : "No streams match the current filter."}
            </div>
          </div>
        ) : (
          <div className="cell overflow-hidden divide-y divide-[var(--border)]" data-testid="streams-list">
            {filtered.map((s) => (
              <ListRow
                key={s.name}
                s={s}
                onMonitor={() => setMonitorFor(s.name)}
                onPush={() => setPushFor(s.name)}
                onOutputs={() => setOutputsFor(s.name)}
                onClients={() => setClientsFor(s.name)}
                onReset={() => reset(s.name)}
                onEdit={() => handleEdit(s.name)}
                onDelete={() => handleDelete(s.name)}
                resetting={!!resetting[s.name]}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </div>

      {outputsFor && (<OutputsModal streamName={outputsFor} onClose={() => setOutputsFor(null)} />)}
      {clientsFor && (<StreamClientsModal streamName={clientsFor} onClose={() => setClientsFor(null)} />)}
      {monitorFor && (<StreamLiveMonitor streamName={monitorFor} onClose={() => setMonitorFor(null)} />)}
      {pushFor && (<PushTargetsModal streamName={pushFor} onClose={() => setPushFor(null)} />)}
      {(wizardOpen || editing) && (
        <StreamWizard
          stream={editing}
          onClose={() => { setWizardOpen(false); setEditing(null); }}
          onSaved={() => { setWizardOpen(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
