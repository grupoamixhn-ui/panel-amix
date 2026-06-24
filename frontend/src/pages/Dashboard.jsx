import { useEffect, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "../components/PageHeader";
import KpiCell from "../components/KpiCell";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

const TICK = { fill: "#71717A", fontSize: 11, fontFamily: "IBM Plex Mono" };

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cell px-3 py-2 mono text-xs">
      <div className="text-[var(--muted)] mb-1">{new Date(label).toLocaleTimeString()}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="dot" style={{ background: p.color }} />
          <span className="text-[var(--muted)]">{p.dataKey}:</span>
          <span className="text-white">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [info, setInfo] = useState(null);
  const [series, setSeries] = useState([]);
  const [streams, setStreams] = useState([]);

  const load = async () => {
    try {
      const [i, s, st] = await Promise.all([
        api.get("/server/info"),
        api.get("/stats?points=24"),
        api.get("/streams"),
      ]);
      setInfo(i.data);
      setSeries(s.data.series || []);
      setStreams(st.data || []);
    } catch (e) { /* noop */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const topStreams = [...streams].sort((a, b) => b.clients - a.clients).slice(0, 6);

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        title="Operations Overview"
        subtitle="REAL-TIME • AUTO REFRESH 5s"
        testId="dashboard-header"
        right={
          <div className="flex items-center gap-3 mono text-xs text-[var(--muted)]">
            <span className="dot dot-live" />
            <span>SYSTEM HEALTHY</span>
            <span className="text-[var(--border-strong)]">|</span>
            <span>v{info?.version || "—"}</span>
          </div>
        }
      />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border)]">
          <KpiCell label="Streams Live" value={info?.streams_live ?? 0} suffix={`/ ${info?.streams_total ?? 0}`} accent="text-[var(--live)]" testId="kpi-streams-live" />
          <KpiCell label="Active Viewers" value={info?.clients ?? 0} testId="kpi-clients" />
          <KpiCell label="Total Bandwidth" value={fmtBitrate(info?.bandwidth_bps || 0)} testId="kpi-bandwidth" />
          <KpiCell label="Uptime" value={fmtUptime(info?.uptime || 0)} hint={`CPU ${info?.cpu ?? 0}% • MEM ${info?.memory ?? 0}%`} testId="kpi-uptime" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="cell p-5 lg:col-span-2" data-testid="chart-viewers">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="label">Concurrent Viewers</div>
                <div className="mono text-2xl font-semibold mt-1">{info?.clients ?? 0}</div>
              </div>
              <div className="text-xs text-[var(--muted)] mono">last 24 min</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#007AFF" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#007AFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272A" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#27272A" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#27272A" }} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="clients" stroke="#007AFF" strokeWidth={2} fill="url(#g1)" />
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
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#27272A" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#27272A" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#27272A" }} tickLine={false} width={50} tickFormatter={(v) => `${(v/1e6).toFixed(0)}M`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="bandwidth" stroke="#22C55E" strokeWidth={2} fill="url(#g2)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="cell" data-testid="top-streams">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <div className="label">Top Streams By Viewers</div>
            <div className="text-xs text-[var(--muted)] mono">{streams.length} total</div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {topStreams.map((s) => (
              <div key={s.name} className="px-5 py-3 grid grid-cols-12 items-center gap-4 cell-hover" data-testid={`top-stream-${s.name}`}>
                <div className="col-span-4 flex items-center gap-3">
                  <span className={`dot ${s.alive ? "dot-live" : s.status === "error" ? "dot-error" : "dot-offline"}`} />
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-[var(--muted)] mono truncate">{s.inputs?.[0]?.url}</div>
                  </div>
                </div>
                <div className="col-span-2 mono text-sm">{s.clients}</div>
                <div className="col-span-2 mono text-sm">{fmtBitrate(s.bitrate)}</div>
                <div className="col-span-2 mono text-sm text-[var(--muted)]">{fmtUptime(s.uptime)}</div>
                <div className="col-span-2 text-xs uppercase tracking-wider mono text-right">
                  <span className={s.alive ? "text-[var(--live)]" : s.status === "error" ? "text-[var(--error)]" : "text-[var(--muted)]"}>
                    {s.status}
                  </span>
                </div>
              </div>
            ))}
            {topStreams.length === 0 && <div className="px-5 py-8 text-center text-[var(--muted)] text-sm">No streams yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
