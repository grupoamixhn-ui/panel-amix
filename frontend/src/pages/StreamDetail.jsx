import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity, ArrowLeft, ChevronRight, Clock, Copy, Eye, Loader2, Pencil,
  Power, RefreshCw, Send, Trash2, Users, Video, Wifi,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Line, LineChart,
} from "recharts";

import api, { fmtBitrate } from "../api";
import { useAuth } from "../auth";
import HlsPlayer from "../components/HlsPlayer";
import OutputsModal from "../components/OutputsModal";
import PushTargetsModal from "../components/PushTargetsModal";
import StreamWizard from "../components/StreamWizard";
import ViewersMap from "../components/ViewersMap";

const POLL_MS = 2500;
const HISTORY_MAX = 60;
const TICK = { fill: "#71717A", fontSize: 10, fontFamily: "IBM Plex Mono" };

function fmtUptime(s) {
  if (!s) return "—";
  s = Number(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function fmtTimeShort(iso) {
  try { return new Date(iso).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
}

function copy(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

export default function StreamDetail() {
  const { name } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "reseller";

  const [meta, setMeta] = useState(null);
  const [live, setLive] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [pushes, setPushes] = useState([]);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [outputsModalOpen, setOutputsModalOpen] = useState(false);
  const [pushesModalOpen, setPushesModalOpen] = useState(false);
  const [busy, setBusy] = useState("");

  const stopped = useRef(false);

  const fetchAll = useCallback(async () => {
    if (stopped.current) return;
    try {
      const [m, l, o, s, p] = await Promise.all([
        api.get(`/streams/${name}`).catch(() => ({ data: null })),
        api.get(`/streams/${name}/live-stats`).catch(() => ({ data: null })),
        api.get(`/streams/${name}/outputs`).catch(() => ({ data: { outputs: [] } })),
        api.get(`/streams/${name}/sessions`).catch(() => ({ data: [] })),
        api.get(`/streams/${name}/pushes`).catch(() => ({ data: [] })),
      ]);
      if (!m.data) {
        setErr("Stream not found");
        return;
      }
      setMeta(m.data);
      setLive(l.data);
      setOutputs(o.data?.outputs || []);
      setSessions(Array.isArray(s.data) ? s.data : []);
      setPushes(Array.isArray(p.data) ? p.data : []);
      setErr("");
      if (l.data) {
        setHistory((prev) => {
          const next = [...prev, {
            ts: l.data.ts || new Date().toISOString(),
            in_kbps: Number(l.data.input_bitrate_kbps) || 0,
            out_kbps: Math.round((Number(l.data.output_bandwidth_bps) || 0) / 1000),
            clients: Number(l.data.clients) || 0,
          }];
          return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
        });
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to load");
    }
  }, [name]);

  useEffect(() => {
    stopped.current = false;
    fetchAll();
    const t = setInterval(fetchAll, POLL_MS);
    return () => { stopped.current = true; clearInterval(t); };
  }, [fetchAll]);

  const hlsUrl = useMemo(() => {
    if (!outputs?.length) return "";
    const hls = outputs.find((o) => o.protocol === "hls" && o.url?.endsWith(".m3u8") && !o.url.includes("_ll"));
    return hls?.url || "";
  }, [outputs]);

  const handleToggle = async () => {
    if (!meta) return;
    setBusy("toggle");
    try {
      await api.post(`/streams/${name}/toggle`, { start: !meta.alive });
      await fetchAll();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally { setBusy(""); }
  };

  const handleReset = async () => {
    if (!window.confirm(`Reset "${name}"? This will reconnect the source and disconnect viewers.`)) return;
    setBusy("reset");
    try {
      await api.post(`/streams/${name}/reset`);
      await fetchAll();
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally { setBusy(""); }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${name}" permanently?`)) return;
    setBusy("delete");
    try {
      await api.delete(`/streams/${name}`);
      nav("/streams");
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
      setBusy("");
    }
  };

  if (err && !meta) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-10">
        <button onClick={() => nav("/streams")} className="btn-ghost text-sm mb-6" data-testid="back-to-streams">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to streams
        </button>
        <div className="cell p-10 text-center">
          <div className="text-base font-semibold text-[var(--text)]">Stream not found</div>
          <div className="text-sm text-[var(--muted)] mt-1">{err}</div>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-20 flex items-center justify-center text-[var(--muted)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading {name}…
      </div>
    );
  }

  const v = live?.video || {};
  const a = live?.audio || {};
  const isAlive = meta.alive;

  return (
    <>
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6" data-testid="stream-detail-page">
        {/* ---------- Header ---------- */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <button onClick={() => nav("/streams")} className="btn-ghost text-xs mb-2" data-testid="back-to-streams">
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Streams
              <ChevronRight className="w-3 h-3 mx-1 opacity-60" />
              <span className="mono text-[var(--text)]">{name}</span>
            </button>
            <h1 className="text-2xl font-semibold text-[var(--text)] mono truncate" title={name}>{name}</h1>
            {meta.title && <div className="text-sm text-[var(--muted)] mt-0.5 truncate">{meta.title}</div>}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`pill ${isAlive ? "pill-live" : "pill-off"}`}
              data-testid="stream-status-pill"
            >
              <span className={`dot ${isAlive ? "dot-live" : "dot-off"}`} />
              {isAlive ? "LIVE" : "OFFLINE"}
            </span>
            <button
              type="button"
              onClick={handleToggle}
              disabled={busy === "toggle"}
              className={`btn ${isAlive ? "btn-warning" : "btn-success"}`}
              data-testid="toggle-btn"
            >
              {busy === "toggle" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Power className="w-3.5 h-3.5 mr-1.5" />}
              {isAlive ? "Stop" : "Start"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={busy === "reset"}
              className="btn btn-secondary"
              data-testid="reset-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${busy === "reset" ? "animate-spin" : ""}`} /> Reset
            </button>
            {canManage && (
              <>
                <button type="button" onClick={() => setEditOpen(true)} className="btn btn-secondary" data-testid="edit-btn">
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                </button>
                <button type="button" onClick={handleDelete} disabled={busy === "delete"} className="btn btn-danger" data-testid="delete-btn">
                  {busy === "delete" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* ---------- HLS Player + KPIs side by side ---------- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            {hlsUrl ? (
              <HlsPlayer url={hlsUrl} />
            ) : (
              <div className="aspect-video rounded-xl bg-[#0F172A] flex flex-col items-center justify-center text-white/60 text-center p-6" data-testid="no-hls-placeholder">
                <Video className="w-10 h-10 mb-2 opacity-40" />
                <div className="text-sm">No HLS output available</div>
                <div className="text-[11px] mt-1 opacity-60">Stream may be offline, or HLS is disabled in Flussonic config.</div>
              </div>
            )}
            {hlsUrl && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <span className="mono truncate flex-1" title={hlsUrl}>{hlsUrl}</span>
                <button onClick={() => copy(hlsUrl)} className="btn-ghost p-1" title="Copy" data-testid="copy-hls-url">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3" data-testid="kpis-column">
            <Kpi icon={Users} label="Viewers" value={live?.clients ?? 0} testId="kpi-viewers" />
            <Kpi icon={Activity} label="Input bitrate" value={live ? fmtBitrate((Number(live.input_bitrate_kbps) || 0) * 1000) : "—"} testId="kpi-input" />
            <Kpi icon={Wifi} label="Output bandwidth" value={live ? fmtBitrate(Number(live.output_bandwidth_bps) || 0) : "—"} testId="kpi-output" />
            <Kpi icon={Clock} label="Uptime" value={fmtUptime(live?.uptime_s || meta.uptime)} testId="kpi-uptime" />
            <Kpi
              icon={Video}
              label="Video"
              value={v.codec ? `${v.codec} · ${v.width || "?"}×${v.height || "?"}` : "—"}
              hint={v.fps ? `${v.fps} fps` : ""}
              testId="kpi-video"
            />
            <Kpi
              icon={Activity}
              label="Audio"
              value={a.codec ? `${a.codec} · ${a.sample_rate ? `${a.sample_rate} Hz` : "?"}` : "—"}
              hint={a.channels ? `${a.channels} ch` : ""}
              testId="kpi-audio"
            />
          </div>
        </div>

        {/* ---------- Live charts ---------- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="Bitrate (kbps)" testId="chart-bitrate">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={history} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-in" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="grad-out" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16A34A" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={fmtTimeShort} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} minTickGap={32} />
                <YAxis tick={TICK} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} width={48} />
                <Tooltip labelFormatter={fmtTimeShort} contentStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="in_kbps"  name="in"  stroke="#2563EB" strokeWidth={2} fill="url(#grad-in)"  isAnimationActive={false} />
                <Area type="monotone" dataKey="out_kbps" name="out" stroke="#16A34A" strokeWidth={2} fill="url(#grad-out)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Viewers" testId="chart-viewers">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={history} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={fmtTimeShort} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} minTickGap={32} />
                <YAxis tick={TICK} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} width={32} />
                <Tooltip labelFormatter={fmtTimeShort} contentStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="clients" name="viewers" stroke="#9333EA" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* ---------- Outputs / Sessions / Pushes summary ---------- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CountCard
            label="Output URLs"
            count={outputs.length}
            icon={Wifi}
            cta="Manage outputs"
            onClick={() => setOutputsModalOpen(true)}
            testId="outputs-summary"
          />
          <CountCard
            label="Active sessions"
            count={sessions.length}
            icon={Users}
            cta="See viewers"
            testId="sessions-summary"
          />
          <CountCard
            label="Push targets"
            count={pushes.length}
            icon={Send}
            cta="Manage pushes"
            onClick={() => setPushesModalOpen(true)}
            testId="pushes-summary"
          />
        </div>

        {/* ---------- Geographic distribution of viewers ---------- */}
        {sessions.length > 0 && <ViewersMap sessions={sessions} />}

        {/* ---------- Active sessions table ---------- */}
        {sessions.length > 0 && (
          <div className="cell p-5" data-testid="sessions-table">
            <div className="flex items-center justify-between mb-3">
              <div className="label flex items-center gap-2"><Users className="w-3.5 h-3.5" /> Active viewers ({sessions.length})</div>
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded-md border border-[var(--border)]">
              <table className="w-full text-xs">
                <thead className="text-[var(--muted)] border-b border-[var(--border)] sticky top-0 bg-[var(--surface)] z-10">
                  <tr>
                    <Th>IP</Th>
                    <Th>Country</Th>
                    <Th>Protocol</Th>
                    <Th>Bitrate</Th>
                    <Th>Bytes sent</Th>
                    <Th>Duration</Th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {sessions.slice(0, 30).map((s, i) => (
                    <tr key={`${s.ip || ""}-${i}`} className="border-b border-[var(--border)]/50 hover:bg-[var(--surface-2)]">
                      <Td>{s.ip || "—"}</Td>
                      <Td>{s.country || "—"}</Td>
                      <Td>{(s.protocol || "—").toUpperCase()}</Td>
                      <Td>{fmtBitrate(Number(s.bitrate) || 0)}</Td>
                      <Td>{fmtBytes(s.bytes_sent)}</Td>
                      <Td>{fmtUptime(s.duration)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sessions.length > 30 && (
              <div className="text-[11px] text-[var(--muted)] mt-2">Showing 30 of {sessions.length}. See Sessions page for full list.</div>
            )}
          </div>
        )}

        {/* ---------- Push targets list ---------- */}
        {pushes.length > 0 && (
          <div className="cell p-5" data-testid="pushes-table">
            <div className="label flex items-center gap-2 mb-3"><Send className="w-3.5 h-3.5" /> Push targets ({pushes.length})</div>
            <ul className="space-y-1.5">
              {pushes.map((p) => (
                <li key={p.url} className="flex items-center gap-3 text-xs">
                  <span className={`pill ${p.active ? "pill-live" : "pill-off"}`}>
                    <span className={`dot ${p.active ? "dot-live" : "dot-off"}`} />
                    {p.label}
                  </span>
                  <span className="mono truncate flex-1 text-[var(--muted)]" title={p.url}>{p.url}</span>
                  {p.bytes > 0 && <span className="mono text-[10px] text-[var(--muted)]">{fmtBytes(p.bytes)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------- Source info ---------- */}
        <div className="cell p-5" data-testid="source-info">
          <div className="label flex items-center gap-2 mb-3"><Eye className="w-3.5 h-3.5" /> Source</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <KV label="URL" value={meta.url} mono />
            <KV label="Publisher" value={live?.publisher_ip ? `${live.publisher_ip} · ${live.publisher_proto || "?"}` : "Waiting for publisher…"} />
            <KV label="Max bitrate" value={meta.max_bitrate_kbps ? `${meta.max_bitrate_kbps} kbps` : "unlimited"} />
            <KV label="Max sessions" value={meta.max_sessions ? `${meta.max_sessions}` : "unlimited"} />
          </div>
        </div>
      </div>

      {editOpen && (
        <StreamWizard
          initial={meta}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); fetchAll(); }}
        />
      )}
      {outputsModalOpen && (
        <OutputsModal streamName={name} onClose={() => setOutputsModalOpen(false)} />
      )}
      {pushesModalOpen && (
        <PushTargetsModal
          streamName={name}
          onClose={() => setPushesModalOpen(false)}
          onChange={fetchAll}
        />
      )}
    </>
  );
}

function Kpi({ icon: Icon, label, value, hint, testId }) {
  return (
    <div className="cell p-3" data-testid={testId}>
      <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-base mono font-semibold text-[var(--text)]">{value}</div>
      {hint && <div className="text-[10px] text-[var(--muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, testId, children }) {
  return (
    <div className="cell p-4" data-testid={testId}>
      <div className="label flex items-center gap-2 mb-2"><Activity className="w-3.5 h-3.5" /> {title}</div>
      {children}
    </div>
  );
}

function CountCard({ label, count, icon: Icon, cta, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="cell p-5 text-left transition-all hover:shadow-md disabled:cursor-default disabled:hover:shadow-none"
      data-testid={testId}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="label flex items-center gap-2"><Icon className="w-3.5 h-3.5" /> {label}</div>
        <div className="mono text-2xl font-semibold text-[var(--text)]">{count}</div>
      </div>
      {cta && onClick && (
        <div className="text-xs text-[var(--primary)] flex items-center gap-1 mt-1">
          {cta} <ChevronRight className="w-3 h-3" />
        </div>
      )}
    </button>
  );
}

function Th({ children }) {
  return <th className="text-left font-medium uppercase tracking-wider text-[10px] py-2 pr-4">{children}</th>;
}
function Td({ children }) {
  return <td className="py-1.5 pr-4 text-[var(--text)]">{children}</td>;
}
function KV({ label, value, mono = false }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`text-sm text-[var(--text)] truncate ${mono ? "mono" : ""}`} title={value}>{value || "—"}</div>
    </div>
  );
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = v; let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x >= 100 ? 0 : 1)} ${units[i]}`;
}
