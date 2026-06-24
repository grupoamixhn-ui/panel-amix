import { useEffect, useState } from "react";
import api, { fmtBitrate } from "../api";
import PageHeader from "../components/PageHeader";
import KpiCell from "../components/KpiCell";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TICK = { fill: "#71717A", fontSize: 11, fontFamily: "IBM Plex Mono" };

function TT({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cell px-3 py-2 mono text-xs">
      <div className="text-[var(--muted)] mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey}>
          <span className="text-[var(--muted)] mr-2">{p.dataKey}:</span>
          <span className="text-white">{fmt ? fmt(p.value) : p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Stats() {
  const [series, setSeries] = useState([]);
  const [streams, setStreams] = useState([]);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, st, i] = await Promise.all([
          api.get("/stats?points=60"),
          api.get("/streams"),
          api.get("/server/info"),
        ]);
        setSeries(s.data.series);
        setStreams(st.data);
        setInfo(i.data);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const byStream = [...streams].sort((a, b) => b.clients - a.clients).slice(0, 10);

  return (
    <div data-testid="stats-page">
      <PageHeader title="Statistics" subtitle="HISTORICAL & DISTRIBUTION" testId="stats-header" />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border)]">
          <KpiCell label="CPU" value={`${info?.cpu ?? 0}%`} testId="stat-cpu" />
          <KpiCell label="Memory" value={`${info?.memory ?? 0}%`} testId="stat-mem" />
          <KpiCell label="Streams" value={info?.streams_total ?? 0} suffix={`${info?.streams_live ?? 0} live`} testId="stat-streams" />
          <KpiCell label="Out Bandwidth" value={fmtBitrate(info?.bandwidth_bps || 0)} testId="stat-bw" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="cell p-5">
            <div className="label mb-3">Viewers — 60 min</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid stroke="#27272A" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#27272A" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#27272A" }} tickLine={false} width={40} />
                <Tooltip content={<TT />} />
                <Line type="monotone" dataKey="clients" stroke="#007AFF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="cell p-5">
            <div className="label mb-3">Bandwidth — 60 min</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid stroke="#27272A" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#27272A" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#27272A" }} tickLine={false} width={50} tickFormatter={(v) => `${(v/1e6).toFixed(0)}M`} />
                <Tooltip content={<TT fmt={fmtBitrate} />} />
                <Line type="monotone" dataKey="bandwidth" stroke="#22C55E" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="cell p-5">
          <div className="label mb-3">Top Streams — Concurrent Viewers</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byStream} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid stroke="#27272A" horizontal={false} />
              <XAxis type="number" tick={TICK} axisLine={{ stroke: "#27272A" }} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={TICK} axisLine={{ stroke: "#27272A" }} tickLine={false} width={120} />
              <Tooltip content={<TT />} cursor={{ fill: "#1E1E1E" }} />
              <Bar dataKey="clients" radius={[0, 0, 0, 0]}>
                {byStream.map((s) => (
                  <Cell key={s.name} fill={s.alive ? "#007AFF" : "#3F3F46"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
