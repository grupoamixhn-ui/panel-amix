import { useCallback, useEffect, useRef, useState } from "react";
import api, { fmtBitrate } from "../api";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { X, Activity, Video, Volume2, Wifi, Users, Clock, Radio } from "lucide-react";

const MAX = 60;     // ~2 minutes at 2s polling
const POLL_MS = 2000;
const TICK = { fill: "#71717A", fontSize: 10, fontFamily: "IBM Plex Mono" };

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
}
function fmtUptime(s) {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${ss}s` : `${ss}s`;
}
function Pill({ children, color = "slate" }) {
  const c = {
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    blue:  "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    purple:"bg-purple-50 text-purple-700 border-purple-200",
    orange:"bg-orange-50 text-orange-700 border-orange-200",
  }[color];
  return <span className={`inline-block text-[10px] mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${c}`}>{children}</span>;
}
function KPI({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)]">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-base mono font-semibold text-[var(--text)]">{value}</div>
      {hint && <div className="text-[10px] text-[var(--muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

export default function StreamLiveMonitor({ streamName, onClose }) {
  const [latest, setLatest] = useState(null);
  const [hist, setHist] = useState([]);
  const [err, setErr] = useState("");
  const stopped = useRef(false);

  const tick = useCallback(async () => {
    if (stopped.current) return;
    try {
      const { data } = await api.get(`/streams/${streamName}/live-stats`);
      setLatest(data); setErr("");
      setHist((p) => {
        const n = [...p, {
          ts: data.ts,
          in_kbps: Number(data.input_bitrate_kbps) || 0,
          out_kbps: Math.round((Number(data.output_bandwidth_bps) || 0) / 1000),
          clients: Number(data.clients) || 0,
        }];
        return n.length > MAX ? n.slice(n.length - MAX) : n;
      });
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed");
    }
  }, [streamName]);

  useEffect(() => {
    stopped.current = false;
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { stopped.current = true; clearInterval(t); };
  }, [tick]);

  const v = latest?.video || {};
  const a = latest?.audio || {};
  const hasPublisher = latest?.publisher_ip && latest?.publisher_proto;

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="stream-monitor-modal">
      <div className="w-full max-w-3xl bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--border)] relative max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="w-4 h-4 text-[var(--primary)] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{streamName}</div>
              <div className="text-[11px] text-[var(--muted)]">Live monitor · refreshes every {POLL_MS/1000}s</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--surface-2)]" data-testid="monitor-close-btn">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {err && (
            <div className="px-3 py-2 rounded-lg bg-[var(--error-soft)] text-[var(--error)] text-xs" data-testid="monitor-error">{err}</div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="monitor-kpis">
            <KPI icon={Wifi} label="Input bitrate" value={`${latest?.input_bitrate_kbps ?? 0} kbit/s`} hint={fmtBitrate((latest?.input_bitrate_kbps||0)*1000)} />
            <KPI icon={Wifi} label="Output BW" value={fmtBitrate(latest?.output_bandwidth_bps||0)} hint={`to ${latest?.clients ?? 0} viewers`} />
            <KPI icon={Users} label="Viewers" value={latest?.clients ?? 0} />
            <KPI icon={Clock} label="Uptime" value={fmtUptime(latest?.uptime_s||0)} hint={latest?.status || "—"} />
          </div>

          {/* Bitrate chart */}
          <div className="cell p-4" data-testid="monitor-bitrate-chart">
            <div className="flex items-center justify-between mb-2">
              <div className="label">Bitrate · in (blue) / out (green) · kbit/s</div>
              <div className="mono text-xs text-[var(--muted)]">{hist.length}/{MAX}</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={hist} margin={{ top: 5, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="g-in" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-out" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16A34A" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={fmtTime} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} minTickGap={32} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={48} />
                <Tooltip
                  contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 11, borderRadius: 8, border: "1px solid #E5E7EB" }}
                  labelFormatter={fmtTime}
                />
                <Area type="monotone" dataKey="in_kbps" name="in" stroke="#2563EB" strokeWidth={2} fill="url(#g-in)" isAnimationActive={false} />
                <Area type="monotone" dataKey="out_kbps" name="out" stroke="#16A34A" strokeWidth={2} fill="url(#g-out)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Video / audio format */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="cell p-4" data-testid="monitor-video">
              <div className="flex items-center gap-2 mb-3">
                <Video className="w-4 h-4 text-[var(--primary)]" />
                <div className="text-xs font-semibold">Video</div>
                {v.codec && <Pill color="blue">{(v.codec || "").toUpperCase()}</Pill>}
              </div>
              {v.codec ? (
                <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
                  <span className="text-[var(--muted)]">Resolution</span><span className="mono font-semibold">{v.width}×{v.height}</span>
                  <span className="text-[var(--muted)]">FPS</span><span className="mono font-semibold">{Number(v.fps).toFixed(1)}</span>
                  <span className="text-[var(--muted)]">Profile</span><span className="mono">{v.profile} {v.level && `· ${v.level}`}</span>
                  <span className="text-[var(--muted)]">Bitrate</span><span className="mono font-semibold">{v.bitrate_kbps} kbit/s</span>
                  <span className="text-[var(--muted)]">Pixel fmt</span><span className="mono">{v.pix_fmt || "—"}</span>
                </div>
              ) : (
                <div className="text-xs text-[var(--muted)] italic">No video track detected</div>
              )}
            </div>

            <div className="cell p-4" data-testid="monitor-audio">
              <div className="flex items-center gap-2 mb-3">
                <Volume2 className="w-4 h-4 text-[var(--primary)]" />
                <div className="text-xs font-semibold">Audio</div>
                {a.codec && <Pill color="purple">{(a.codec || "").toUpperCase()}</Pill>}
              </div>
              {a.codec ? (
                <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
                  <span className="text-[var(--muted)]">Channels</span><span className="mono font-semibold">{a.channels === 2 ? "stereo" : a.channels === 1 ? "mono" : `${a.channels}ch`}</span>
                  <span className="text-[var(--muted)]">Sample rate</span><span className="mono font-semibold">{(a.sample_rate / 1000).toFixed(1)} kHz</span>
                  <span className="text-[var(--muted)]">Bitrate</span><span className="mono font-semibold">{a.bitrate_kbps} kbit/s</span>
                </div>
              ) : (
                <div className="text-xs text-[var(--muted)] italic">No audio track detected</div>
              )}
            </div>
          </div>

          {/* Publisher info if push */}
          {hasPublisher && (
            <div className="cell p-3 flex items-center gap-3" data-testid="monitor-publisher">
              <Radio className="w-4 h-4 text-[var(--primary)]" />
              <div className="text-xs">
                <span className="text-[var(--muted)]">Publisher:</span>{" "}
                <Pill color={latest.publisher_proto === "rtmp" ? "orange" : "purple"}>{latest.publisher_proto.toUpperCase()}</Pill>{" "}
                <span className="mono font-semibold ml-1">{latest.publisher_ip}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
