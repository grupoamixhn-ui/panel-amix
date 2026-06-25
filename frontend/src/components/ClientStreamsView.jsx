import { useCallback, useEffect, useMemo, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "./PageHeader";
import OutputsModal from "./OutputsModal";
import StreamClientsModal from "./StreamClientsModal";
import StreamLiveMonitor from "./StreamLiveMonitor";
import PushTargetsModal from "./PushTargetsModal";
import HlsPlayer from "./HlsPlayer";
import {
  Search, Activity, Send, Users, Share2, Wifi, Clock, RotateCw, Tv2, Play,
  Eye, EyeOff, LayoutGrid, List, Radio, Zap,
} from "lucide-react";

function StatusBadge({ s }) {
  if (s.alive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-bold uppercase tracking-wider ring-1 ring-emerald-500/30 backdrop-blur-sm">
        <span className="relative flex w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
          <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
        </span>
        Live
      </span>
    );
  }
  if (s.status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 text-[10px] font-bold uppercase tracking-wider ring-1 ring-red-500/30">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-500/15 text-slate-300 text-[10px] font-bold uppercase tracking-wider ring-1 ring-slate-500/30">
      Idle
    </span>
  );
}

function SourceProto({ s }) {
  const url = s.inputs?.[0]?.url || "";
  const isPub = url.startsWith("publish://");
  if (isPub && s.publisher_ip) {
    const proto = (s.publisher_proto || "").toUpperCase();
    return (
      <span className="text-[10px] mono text-slate-400">
        <span className={`${proto === "RTMP" ? "text-orange-300" : proto === "SRT" ? "text-purple-300" : "text-slate-300"} font-bold`}>{proto || "PUSH"}</span>
        <span className="mx-1.5 opacity-50">·</span>{s.publisher_ip}
      </span>
    );
  }
  if (isPub) return <span className="text-[10px] italic text-slate-500">waiting for publisher</span>;
  if (url) {
    const proto = url.startsWith("hls") ? "HLS" : url.startsWith("rtmp") ? "RTMP" : url.startsWith("srt") ? "SRT" : "URL";
    return <span className="text-[10px] mono text-slate-400"><span className="text-cyan-300 font-bold">{proto}</span> source</span>;
  }
  return null;
}

function StreamCard({ s, onMonitor, onPush, onOutputs, onClients, onReset, resetting }) {
  const [showPreview, setShowPreview] = useState(false);
  const [hlsUrl, setHlsUrl] = useState("");
  const [hlsLoading, setHlsLoading] = useState(false);
  const isLive = s.alive;

  const togglePreview = async () => {
    if (showPreview) { setShowPreview(false); return; }
    setShowPreview(true);
    if (!hlsUrl) {
      setHlsLoading(true);
      try {
        const r = await api.get(`/streams/${encodeURIComponent(s.name)}/outputs`);
        const hls = (r.data?.outputs || []).find((o) => o.protocol === "hls" && o.url?.endsWith(".m3u8"));
        if (hls) setHlsUrl(hls.url);
      } catch { /* ignore */ } finally { setHlsLoading(false); }
    }
  };

  return (
    <div
      className={`group relative rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 ${
        isLive
          ? "bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 ring-1 ring-emerald-500/30 shadow-[0_0_0_1px_rgba(16,185,129,0.1),0_20px_40px_-20px_rgba(16,185,129,0.4)]"
          : "bg-gradient-to-br from-slate-900 to-slate-950 ring-1 ring-slate-800 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.5)]"
      }`}
      data-testid={`stream-card-${s.name}`}
    >
      {/* Animated gradient border for live streams */}
      {isLive && (
        <div className="absolute inset-0 rounded-2xl opacity-50 pointer-events-none">
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
        </div>
      )}

      {/* Preview area / hero */}
      <div className="relative aspect-video bg-black/60 overflow-hidden">
        {showPreview && hlsUrl ? (
          <div className="absolute inset-0">
            <HlsPlayer url={hlsUrl} />
          </div>
        ) : (
          <>
            {/* Subtle background pattern */}
            <div className="absolute inset-0 opacity-30" style={{
              backgroundImage: "radial-gradient(circle at 30% 50%, rgba(99,102,241,0.15), transparent 60%), radial-gradient(circle at 70% 80%, rgba(16,185,129,0.1), transparent 50%)",
            }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center ${isLive ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : "bg-slate-800/50 ring-1 ring-slate-700/50"}`}>
                <Tv2 className={`w-10 h-10 ${isLive ? "text-emerald-400" : "text-slate-500"}`} strokeWidth={1.5} />
              </div>
            </div>
            {isLive && (
              <button
                onClick={togglePreview}
                disabled={hlsLoading}
                className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/40 transition-colors group/play"
                data-testid={`card-preview-${s.name}`}
              >
                <div className="px-4 py-2.5 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 text-white text-xs font-semibold opacity-0 group-hover/play:opacity-100 transition-opacity flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 fill-current" /> {hlsLoading ? "Loading…" : "Watch preview"}
                </div>
              </button>
            )}
          </>
        )}

        {/* Status badge top-left */}
        <div className="absolute top-3 left-3 z-10">
          <StatusBadge s={s} />
        </div>

        {/* Viewers top-right */}
        {isLive && (
          <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md ring-1 ring-white/10 text-white text-[10px] font-bold">
            <Eye className="w-3 h-3" /> {(s.clients || 0).toLocaleString()}
          </div>
        )}

        {/* Bottom info gradient */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3 z-10">
          <div className="text-white font-bold text-base truncate" title={s.name}>{s.name}</div>
          <div className="mt-0.5"><SourceProto s={s} /></div>
        </div>

        {/* Close preview button */}
        {showPreview && (
          <button
            onClick={() => setShowPreview(false)}
            className="absolute top-3 right-3 z-20 w-7 h-7 rounded-full bg-black/70 hover:bg-black/90 backdrop-blur text-white flex items-center justify-center"
            title="Close preview"
            data-testid={`card-preview-close-${s.name}`}
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Bottom panel */}
      <div className="p-4 bg-slate-900/40 backdrop-blur">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg bg-slate-800/40 px-2.5 py-2 ring-1 ring-slate-700/40">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">
              <Users className="w-2.5 h-2.5" /> Viewers
            </div>
            <div className="text-[15px] font-bold mono text-white" data-testid={`card-viewers-${s.name}`}>{(s.clients || 0).toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-slate-800/40 px-2.5 py-2 ring-1 ring-slate-700/40">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">
              <Wifi className="w-2.5 h-2.5" /> Bitrate
            </div>
            <div className="text-[15px] font-bold mono text-white">{fmtBitrate(s.bitrate || 0)}</div>
          </div>
          <div className="rounded-lg bg-slate-800/40 px-2.5 py-2 ring-1 ring-slate-700/40">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">
              <Clock className="w-2.5 h-2.5" /> Uptime
            </div>
            <div className="text-[15px] font-bold mono text-white truncate">{fmtUptime(s.uptime || 0)}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-4 gap-1.5">
          <button onClick={onMonitor} className="group/btn flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg bg-slate-800/40 hover:bg-emerald-500/15 hover:ring-1 hover:ring-emerald-500/40 text-slate-300 hover:text-emerald-300 transition" data-testid={`card-monitor-${s.name}`} title="Live monitor (graphs)">
            <Activity className="w-4 h-4" />
            <span className="text-[9px] font-semibold uppercase tracking-wider">Monitor</span>
          </button>
          <button onClick={onPush} className="group/btn flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg bg-slate-800/40 hover:bg-pink-500/15 hover:ring-1 hover:ring-pink-500/40 text-slate-300 hover:text-pink-300 transition" data-testid={`card-push-${s.name}`} title="Push to social networks">
            <Send className="w-4 h-4" />
            <span className="text-[9px] font-semibold uppercase tracking-wider">Push</span>
          </button>
          <button onClick={onOutputs} className="group/btn flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg bg-slate-800/40 hover:bg-cyan-500/15 hover:ring-1 hover:ring-cyan-500/40 text-slate-300 hover:text-cyan-300 transition" data-testid={`card-outputs-${s.name}`} title="Playback URLs (HLS / RTMP / SRT)">
            <Share2 className="w-4 h-4" />
            <span className="text-[9px] font-semibold uppercase tracking-wider">URLs</span>
          </button>
          <button onClick={onClients} className="group/btn flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg bg-slate-800/40 hover:bg-indigo-500/15 hover:ring-1 hover:ring-indigo-500/40 text-slate-300 hover:text-indigo-300 transition" data-testid={`card-clients-${s.name}`} title="Connected viewers">
            <Users className="w-4 h-4" />
            <span className="text-[9px] font-semibold uppercase tracking-wider">Viewers</span>
          </button>
        </div>

        <button
          onClick={onReset}
          disabled={resetting}
          className="mt-2 w-full px-3 py-2 text-[10px] font-semibold uppercase tracking-wider rounded-lg text-slate-500 hover:text-amber-300 hover:bg-amber-500/10 transition flex items-center justify-center gap-1.5"
          title="Reset · kick viewers & reconnect source"
          data-testid={`card-reset-${s.name}`}
        >
          <RotateCw className={`w-3 h-3 ${resetting ? "animate-spin" : ""}`} />
          {resetting ? "Resetting…" : "Reset stream"}
        </button>
      </div>
    </div>
  );
}

function ListRow({ s, onMonitor, onPush, onOutputs, onClients, onReset, resetting }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3.5 hover:bg-slate-800/40 transition ${s.alive ? "border-l-2 border-emerald-500" : "border-l-2 border-transparent"}`} data-testid={`stream-row-${s.name}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${s.alive ? "bg-emerald-500/15 ring-1 ring-emerald-500/30" : "bg-slate-800/60"}`}>
          <Tv2 className={`w-4 h-4 ${s.alive ? "text-emerald-400" : "text-slate-500"}`} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-white truncate">{s.name}</div>
          <div className="mt-0.5"><SourceProto s={s} /></div>
        </div>
      </div>
      <div className="text-right min-w-[80px]">
        <div className="text-[9px] uppercase tracking-wider text-slate-500">Viewers</div>
        <div className="text-sm mono font-bold text-white">{(s.clients || 0).toLocaleString()}</div>
      </div>
      <div className="text-right min-w-[110px]">
        <div className="text-[9px] uppercase tracking-wider text-slate-500">Bitrate</div>
        <div className="text-sm mono font-bold text-white">{fmtBitrate(s.bitrate || 0)}</div>
      </div>
      <StatusBadge s={s} />
      <div className="flex items-center gap-1">
        <button onClick={onMonitor} className="w-8 h-8 rounded-md text-slate-400 hover:bg-slate-800 hover:text-emerald-300" title="Monitor" data-testid={`row-monitor-${s.name}`}><Activity className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onPush} className="w-8 h-8 rounded-md text-slate-400 hover:bg-slate-800 hover:text-pink-300" title="Push" data-testid={`row-push-${s.name}`}><Send className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onOutputs} className="w-8 h-8 rounded-md text-slate-400 hover:bg-slate-800 hover:text-cyan-300" title="URLs" data-testid={`row-urls-${s.name}`}><Share2 className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onClients} className="w-8 h-8 rounded-md text-slate-400 hover:bg-slate-800 hover:text-indigo-300" title="Viewers" data-testid={`row-viewers-${s.name}`}><Users className="w-3.5 h-3.5 mx-auto" /></button>
        <button onClick={onReset} disabled={resetting} className="w-8 h-8 rounded-md text-slate-400 hover:bg-slate-800 hover:text-amber-300" title="Reset" data-testid={`row-reset-${s.name}`}><RotateCw className={`w-3.5 h-3.5 mx-auto ${resetting ? "animate-spin" : ""}`} /></button>
      </div>
    </div>
  );
}

export default function ClientStreamsView() {
  const [streams, setStreams] = useState([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState("grid"); // grid | list
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

  const totals = useMemo(() => {
    const live = streams.filter((s) => s.alive).length;
    const viewers = streams.reduce((a, s) => a + (s.clients || 0), 0);
    const bw = streams.reduce((a, s) => a + (s.bitrate || 0), 0);
    const error = streams.filter((s) => s.status === "error").length;
    return { live, viewers, bw, error, total: streams.length };
  }, [streams]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    // Sort live first
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
    <div data-testid="streams-page" className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 -m-0">
      {/* Decorative background */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle at 15% 10%, rgba(16,185,129,0.08), transparent 50%), radial-gradient(circle at 85% 80%, rgba(99,102,241,0.06), transparent 50%)",
      }} />

      <div className="relative">
        <PageHeader
          title="My streams"
          subtitle="Live broadcast control center"
          testId="streams-header"
          right={
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30 backdrop-blur">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-xs font-bold text-emerald-300">{totals.live} live</span>
            </div>
          }
        />

        <div className="px-4 md:px-8 pb-8 space-y-5">
          {/* Hero KPI strip — full width */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 ring-1 ring-slate-800 p-5">
              <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-emerald-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center">
                  <Radio className="w-4.5 h-4.5 text-emerald-400" />
                </div>
                <div className="text-[10px] mono uppercase tracking-widest text-slate-500">Total streams</div>
              </div>
              <div className="text-4xl font-bold mono text-white">{totals.total}</div>
              <div className="text-[11px] text-slate-400 mt-1">{totals.live} live · {totals.error} error</div>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 ring-1 ring-slate-800 p-5">
              <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-indigo-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/15 ring-1 ring-indigo-500/30 flex items-center justify-center">
                  <Users className="w-4.5 h-4.5 text-indigo-400" />
                </div>
                <div className="text-[10px] mono uppercase tracking-widest text-slate-500">Active viewers</div>
              </div>
              <div className="text-4xl font-bold mono text-white">{totals.viewers.toLocaleString()}</div>
              <div className="text-[11px] text-slate-400 mt-1">across all your streams</div>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 ring-1 ring-slate-800 p-5">
              <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-cyan-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 ring-1 ring-cyan-500/30 flex items-center justify-center">
                  <Wifi className="w-4.5 h-4.5 text-cyan-400" />
                </div>
                <div className="text-[10px] mono uppercase tracking-widest text-slate-500">Output bandwidth</div>
              </div>
              <div className="text-4xl font-bold mono text-white">{fmtBitrate(totals.bw)}</div>
              <div className="text-[11px] text-slate-400 mt-1">aggregate live throughput</div>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 ring-1 ring-slate-800 p-5">
              <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-amber-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center">
                  <Zap className="w-4.5 h-4.5 text-amber-400" />
                </div>
                <div className="text-[10px] mono uppercase tracking-widest text-slate-500">Availability</div>
              </div>
              <div className="text-4xl font-bold mono text-white">{totals.total > 0 ? Math.round((totals.live / totals.total) * 100) : 0}<span className="text-2xl text-slate-500">%</span></div>
              <div className="text-[11px] text-slate-400 mt-1">streams online</div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                data-testid="streams-search"
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search streams…"
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-900/60 ring-1 ring-slate-800 text-white placeholder:text-slate-500 rounded-xl focus:ring-emerald-500/40 focus:outline-none"
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
                      ? "bg-emerald-500 text-slate-950 shadow-[0_0_20px_-5px_rgba(16,185,129,0.6)]"
                      : "bg-slate-900/60 ring-1 ring-slate-800 text-slate-400 hover:text-white hover:ring-slate-600"
                  }`}
                >{lbl}</button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1 p-1 bg-slate-900/60 ring-1 ring-slate-800 rounded-lg">
              <button
                onClick={() => setView("grid")}
                className={`px-2 py-1.5 rounded-md transition ${view === "grid" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-white"}`}
                title="Grid view"
                data-testid="view-grid"
              ><LayoutGrid className="w-3.5 h-3.5" /></button>
              <button
                onClick={() => setView("list")}
                className={`px-2 py-1.5 rounded-md transition ${view === "list" ? "bg-slate-700 text-white" : "text-slate-500 hover:text-white"}`}
                title="List view"
                data-testid="view-list"
              ><List className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          {/* Streams */}
          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-slate-900/40 ring-1 ring-slate-800 p-16 text-center" data-testid="empty-state">
              <Tv2 className="w-12 h-12 text-slate-700 mx-auto mb-3" strokeWidth={1.5} />
              <div className="text-sm text-slate-400">
                {streams.length === 0
                  ? "No streams have been assigned to your account yet. Contact your provider to get started."
                  : "No streams match the current filter."}
              </div>
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="streams-grid">
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
          ) : (
            <div className="rounded-2xl bg-slate-900/40 ring-1 ring-slate-800 overflow-hidden divide-y divide-slate-800" data-testid="streams-list">
              {filtered.map((s) => (
                <ListRow
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
      </div>

      {outputsFor && (<OutputsModal streamName={outputsFor} onClose={() => setOutputsFor(null)} />)}
      {clientsFor && (<StreamClientsModal streamName={clientsFor} onClose={() => setClientsFor(null)} />)}
      {monitorFor && (<StreamLiveMonitor streamName={monitorFor} onClose={() => setMonitorFor(null)} />)}
      {pushFor && (<PushTargetsModal streamName={pushFor} onClose={() => setPushFor(null)} />)}
    </div>
  );
}
