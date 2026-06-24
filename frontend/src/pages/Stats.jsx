import { useCallback, useEffect, useState } from "react";
import api, { fmtBitrate } from "../api";
import PageHeader from "../components/PageHeader";
import KpiCell from "../components/KpiCell";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Cpu, MemoryStick, Radio, Wifi } from "lucide-react";

const TICK = { fill: "#71717A", fontSize: 11, fontFamily: "IBM Plex Mono" };

function TT({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cell px-3 py-2 mono text-xs shadow-[var(--shadow-lg)]">
      <div className="text-[var(--muted)] mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey}>
          <span className="text-[var(--muted)] mr-2">{p.dataKey}:</span>
          <span className="text-[var(--text)] font-semibold">{fmt ? fmt(p.value) : p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function Stats() {
  const [series, setSeries] = useState([]);
  const [streams, setStreams] = useState([]);
  const [info, setInfo] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, st, i] = await Promise.all([
        api.get("/stats?points=60"),
        api.get("/streams"),
        api.get("/server/info"),
      ]);
      setSeries(s.data.series);
      setStreams(st.data);
      setInfo(i.data);
    } catch (e) {
      console.error("stats load failed", e);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const byStream = [...streams].sort((a, b) => b.clients - a.clients).slice(0, 10);

  return (
    <div data-testid="stats-page">
      <PageHeader title="Statistics" subtitle="Historical & distribution" testId="stats-header" />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCell icon={Cpu} label="CPU" value={`${info?.cpu ?? 0}%`} testId="stat-cpu" />
          <KpiCell icon={MemoryStick} label="Memory" value={`${info?.memory ?? 0}%`} testId="stat-mem" />
          <KpiCell icon={Radio} label="Streams" value={info?.streams_total ?? 0} suffix={`${info?.streams_live ?? 0} live`} testId="stat-streams" />
          <KpiCell icon={Wifi} label="Out bandwidth" value={fmtBitrate(info?.bandwidth_bps || 0)} testId="stat-bw" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="cell p-5" data-testid="chart-viewers-history">
            <div className="label mb-3">Viewers · 60 min</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={40} />
                <Tooltip content={<TT />} />
                <Line type="monotone" dataKey="clients" stroke="#2563EB" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="cell p-5" data-testid="chart-bandwidth-history">
            <div className="label mb-3">Bandwidth · 60 min</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={(v) => new Date(v).toLocaleTimeString().slice(0,5)} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={50} tickFormatter={(v) => `${(v/1e6).toFixed(0)}M`} />
                <Tooltip content={<TT fmt={fmtBitrate} />} />
                <Line type="monotone" dataKey="bandwidth" stroke="#16A34A" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="cell p-5" data-testid="chart-top-streams">
          <div className="label mb-3">Top streams · concurrent viewers</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byStream} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid stroke="#E5E7EB" horizontal={false} />
              <XAxis type="number" tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} />
              <YAxis dataKey="name" type="category" tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={120} />
              <Tooltip content={<TT />} cursor={{ fill: "#F4F4F5" }} />
              <Bar dataKey="clients" radius={[0, 6, 6, 0]}>
                {byStream.map((s) => (
                  <Cell key={s.name} fill={s.alive ? "#2563EB" : "#D4D4D8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
