import { useCallback, useEffect, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "../components/PageHeader";
import KpiCell from "../components/KpiCell";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Radio, Users, Wifi, Clock, ArrowRight } from "lucide-react";

const TICK = { fill: "#71717A", fontSize: 11, fontFamily: "IBM Plex Mono" };

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cell px-3 py-2 mono text-xs shadow-[var(--shadow-lg)]">
      <div className="text-[var(--muted)] mb-1">{new Date(label).toLocaleTimeString()}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="dot" style={{ background: p.color }} />
          <span className="text-[var(--muted)]">{p.dataKey}:</span>
          <span className="text-[var(--text)] font-semibold">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function statusPill(s) {
  if (s.alive) return <span className="pill pill-live"><span className="dot dot-live" />Live</span>;
  if (s.status === "error") return <span className="pill pill-error">Error</span>;
  return <span className="pill pill-off">Idle</span>;
}

export default function Dashboard() {
  const [info, setInfo] = useState(null);
  const [series, setSeries] = useState([]);
  const [streams, setStreams] = useState([]);

  const load = useCallback(async () => {
    try {
      const [i, s, st] = await Promise.all([
        api.get("/server/info"),
        api.get("/stats?points=24"),
        api.get("/streams"),
      ]);
      setInfo(i.data);
      setSeries(s.data.series || []);
      setStreams(st.data || []);
    } catch (e) {
      console.error("dashboard load failed", e);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const topStreams = [...streams].sort((a, b) => b.clients - a.clients).slice(0, 6);

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        title="Operations Overview"
        subtitle="Real-time · Auto refresh 5s"
        testId="dashboard-header"
        right={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--live-soft)] border border-[#BBF7D0]">
            <span className="dot dot-live" />
            <span className="text-xs font-semibold text-[#15803D]">System healthy</span>
            <span className="text-xs text-[#15803D]/60">· v{info?.version || "—"}</span>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCell icon={Radio} label="Streams live" value={info?.streams_live ?? 0} suffix={`/ ${info?.streams_total ?? 0}`} accent="text-[var(--live)]" testId="kpi-streams-live" />
          <KpiCell icon={Users} label="Active viewers" value={info?.clients ?? 0} trend="+2.4%" testId="kpi-clients" />
          <KpiCell icon={Wifi} label="Total bandwidth" value={fmtBitrate(info?.bandwidth_bps || 0)} testId="kpi-bandwidth" />
          <KpiCell icon={Clock} label="Uptime" value={fmtUptime(info?.uptime || 0)} hint="live · auto refresh 5s" testId="kpi-uptime" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="cell p-5" data-testid="chart-viewers">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="label">Concurrent viewers</div>
                <div className="mono text-2xl font-semibold mt-1">{info?.clients ?? 0}</div>
              </div>
              <div className="text-xs text-[var(--muted)] mono">last 24 min</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="clients" stroke="#2563EB" strokeWidth={2.5} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="cell p-5" data-testid="chart-bandwidth">
            <div className="label mb-1">Bandwidth</div>
            <div className="mono text-2xl font-semibold mb-4">{fmtBitrate(info?.bandwidth_bps || 0)}</div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16A34A" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={50} tickFormatter={(v) => `${(v/1e6).toFixed(0)}M`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="bandwidth" stroke="#16A34A" strokeWidth={2.5} fill="url(#g2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="cell" data-testid="top-streams">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <div>
              <div className="label">Top streams by viewers</div>
              <div className="text-xs text-[var(--muted)] mt-0.5">{streams.length} total streams</div>
            </div>
            <a href="/streams" className="text-xs text-[var(--primary)] font-medium inline-flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {topStreams.map((s) => (
              <div key={s.name} className="px-5 py-3.5 grid grid-cols-12 items-center gap-4 hover:bg-[var(--surface-2)] transition-colors" data-testid={`top-stream-${s.name}`}>
                <div className="col-span-4 flex items-center gap-3">
                  <span className={`dot ${s.alive ? "dot-live" : s.status === "error" ? "dot-error" : "dot-offline"}`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.name}</div>
                    <div className="text-xs text-[var(--muted)] mono truncate">{s.inputs?.[0]?.url}</div>
                  </div>
                </div>
                <div className="col-span-2 mono text-sm font-semibold">{s.clients.toLocaleString()}</div>
                <div className="col-span-2 mono text-sm">{fmtBitrate(s.bitrate)}</div>
                <div className="col-span-2 mono text-xs text-[var(--muted)]">{fmtUptime(s.uptime)}</div>
                <div className="col-span-2 text-right">{statusPill(s)}</div>
              </div>
            ))}
            {topStreams.length === 0 && <div className="px-5 py-10 text-center text-[var(--muted)] text-sm">No streams yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
