import { useCallback, useEffect, useRef, useState } from "react";
import api, { fmtBitrate } from "../api";
import PageHeader from "../components/PageHeader";
import KpiCell from "../components/KpiCell";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, AlertTriangle, Cpu, HardDrive, MemoryStick, Pause, Play, Radio, Server, Users, Wifi } from "lucide-react";

const TICK = { fill: "#71717A", fontSize: 10, fontFamily: "IBM Plex Mono" };
const MAX_POINTS = 60;          // ~3 minutes at 3s refresh
const REFRESH_MS = 3000;

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function fmtBytes(n) {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(n); let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function fmtUptime(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function PercentTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cell px-3 py-2 mono text-xs shadow-[var(--shadow-lg)]">
      <div className="text-[var(--muted)] mb-1">{fmtTime(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey}>
          <span className="text-[var(--muted)] mr-2">{p.dataKey}:</span>
          <span className="text-[var(--text)] font-semibold">{Number(p.value).toFixed(1)} %</span>
        </div>
      ))}
    </div>
  );
}

function BwTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cell px-3 py-2 mono text-xs shadow-[var(--shadow-lg)]">
      <div className="text-[var(--muted)] mb-1">{fmtTime(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey}>
          <span className="text-[var(--muted)] mr-2">{p.name || p.dataKey}:</span>
          <span className="text-[var(--text)] font-semibold">{fmtBitrate(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function MiniChart({ data, dataKey, color, formatter, tooltip, unit }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E5E7EB" vertical={false} />
        <XAxis
          dataKey="ts"
          tick={TICK}
          tickFormatter={fmtTime}
          axisLine={{ stroke: "#E5E7EB" }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tick={TICK}
          axisLine={{ stroke: "#E5E7EB" }}
          tickLine={false}
          width={48}
          tickFormatter={formatter}
          domain={unit === "%" ? [0, 100] : ["auto", "auto"]}
        />
        <Tooltip content={tooltip} />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2.2}
          fill={`url(#grad-${dataKey})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function HwItem({ icon: Icon, label, value, mono = true, testId }) {
  return (
    <div className="flex items-start gap-2.5 min-w-0" data-testid={testId}>
      {Icon && <Icon className="w-3.5 h-3.5 text-[var(--muted)] mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="label text-[10px]">{label}</div>
        <div className={`text-sm text-[var(--text)] truncate ${mono ? "mono" : ""}`} title={value}>
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

function HardwareInfoCard({ hw }) {
  const p = hw?.panel_host || {};
  const f = hw?.flussonic || {};
  const ramUsed = p.ram_total_bytes && p.ram_available_bytes
    ? p.ram_total_bytes - p.ram_available_bytes
    : 0;
  const ramPct = p.ram_total_bytes ? (ramUsed / p.ram_total_bytes) * 100 : 0;

  return (
    <div className="cell p-5" data-testid="hardware-info">
      <div className="flex items-center justify-between mb-4">
        <div className="label flex items-center gap-2">
          <Server className="w-3.5 h-3.5" /> Hardware &amp; Runtime
        </div>
        {f.reachable && (
          <div className="mono text-[11px] text-[var(--muted)]" data-testid="hw-flussonic-status">
            Flussonic {f.version || "online"}{f.edition ? ` · ${f.edition}` : ""}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-4">
        <HwItem icon={Cpu} label="CPU" value={p.cpu_model} mono={false} testId="hw-cpu-model" />
        <HwItem
          icon={Cpu}
          label="Cores / Threads"
          value={p.cpu_cores ? `${p.cpu_cores} / ${p.cpu_threads}` : ""}
          testId="hw-cpu-cores"
        />
        <HwItem
          icon={MemoryStick}
          label="RAM total"
          value={p.ram_total_bytes ? `${fmtBytes(p.ram_total_bytes)} (${ramPct.toFixed(0)}% used)` : ""}
          testId="hw-ram"
        />
        <HwItem icon={HardDrive} label="Kernel" value={p.kernel} testId="hw-kernel" />
        <HwItem icon={Server} label="OS / Arch" value={p.os ? `${p.os} · ${p.arch}` : p.arch} mono={false} testId="hw-os" />
        <HwItem
          icon={Server}
          label="Flussonic"
          value={f.reachable
            ? `${f.hostname || "—"}${f.uptime_s ? ` · up ${fmtUptime(f.uptime_s)}` : ""}`
            : "unreachable"}
          testId="hw-flussonic"
        />
      </div>
    </div>
  );
}

export default function Monitor() {
  const [history, setHistory] = useState([]);     // rolling window
  const [latest, setLatest] = useState(null);
  const [hw, setHw] = useState(null);             // hardware info — fetched once
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const tick = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const { data } = await api.get("/monitor/metrics");
      setLatest(data);
      setError("");
      setHistory((prev) => {
        const next = [
          ...prev,
          {
            ts: data.ts,
            cpu: Number(data.cpu) || 0,
            memory: Number(data.memory) || 0,
            bandwidth_in: Number(data.bandwidth_in_bps) || 0,
            bandwidth_out: Number(data.bandwidth_out_bps) || 0,
            clients: Number(data.clients) || 0,
          },
        ];
        return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
      });
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to fetch metrics");
    }
  }, []);

  useEffect(() => {
    tick();
    const t = setInterval(tick, REFRESH_MS);
    return () => clearInterval(t);
  }, [tick]);

  // Hardware info — fetched once on mount + every 60s (cheap, mostly static)
  useEffect(() => {
    let alive = true;
    const fetchHw = async () => {
      try {
        const { data } = await api.get("/server/hardware");
        if (alive) setHw(data);
      } catch {
        /* silent — hardware card simply hides if unavailable */
      }
    };
    fetchHw();
    const t = setInterval(fetchHw, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const cpuRamBlocked = latest && !latest.cpu_ram_available && latest.mode === "live";

  return (
    <div data-testid="monitor-page">
      <PageHeader
        title="Real-time Monitor"
        subtitle="Server health · live"
        testId="monitor-header"
        right={
          <button
            data-testid="monitor-pause-btn"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs mono uppercase tracking-wider rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] transition-colors"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
        }
      />

      <div className="p-4 md:p-8 space-y-6">
        {error && (
          <div className="cell p-4 flex items-start gap-3 border-[var(--error)]" data-testid="monitor-error">
            <AlertTriangle className="w-4 h-4 text-[var(--error)] mt-0.5" />
            <div className="text-sm text-[var(--text)]">{error}</div>
          </div>
        )}

        {cpuRamBlocked && (
          <div
            data-testid="monitor-cpu-warning"
            className="rounded-xl border border-[#FCD34D] bg-[#FFFBEB] px-4 py-3 flex items-start gap-3"
          >
            <AlertTriangle className="w-4 h-4 text-[#B45309] mt-0.5" />
            <div className="text-sm text-[#78350F] leading-snug">
              <div className="font-semibold mb-0.5">CPU / RAM no disponibles</div>
              <div className="text-[13px]">
                {latest?.source_warning ||
                  "El endpoint /streamer/api/v3/server está bloqueado por tu proxy. Pide a tu operador habilitarlo para ver CPU y RAM en tiempo real."}
              </div>
            </div>
          </div>
        )}

        {hw && <HardwareInfoCard hw={hw} />}

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KpiCell
            icon={Cpu}
            label="CPU"
            value={cpuRamBlocked ? "—" : `${(latest?.cpu ?? 0).toFixed(1)}%`}
            hint={cpuRamBlocked ? "blocked by proxy" : "current load"}
            testId="kpi-cpu"
          />
          <KpiCell
            icon={MemoryStick}
            label="Memory"
            value={cpuRamBlocked ? "—" : `${(latest?.memory ?? 0).toFixed(1)}%`}
            hint={cpuRamBlocked ? "blocked by proxy" : "RAM usage"}
            testId="kpi-mem"
          />
          <KpiCell
            icon={Wifi}
            label="Bandwidth in"
            value={fmtBitrate(latest?.bandwidth_in_bps ?? 0)}
            hint="from publishers"
            testId="kpi-bw-in"
          />
          <KpiCell
            icon={Wifi}
            label="Bandwidth out"
            value={fmtBitrate(latest?.bandwidth_out_bps ?? 0)}
            hint="to viewers"
            testId="kpi-bw-out"
          />
          <KpiCell
            icon={Users}
            label="Viewers"
            value={latest?.clients ?? 0}
            hint="active sessions"
            testId="kpi-viewers"
          />
          <KpiCell
            icon={Radio}
            label="Streams"
            value={latest?.streams_total ?? 0}
            suffix={`${latest?.streams_live ?? 0} live`}
            testId="kpi-streams"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="cell p-5" data-testid="chart-cpu">
            <div className="flex items-center justify-between mb-3">
              <div className="label flex items-center gap-2"><Cpu className="w-3.5 h-3.5" /> CPU · live</div>
              <div className="mono text-xs text-[var(--muted)]">
                {cpuRamBlocked ? "—" : `${(latest?.cpu ?? 0).toFixed(1)} %`}
              </div>
            </div>
            <MiniChart
              data={history}
              dataKey="cpu"
              color="#DC2626"
              formatter={(v) => `${v}%`}
              tooltip={<PercentTooltip />}
              unit="%"
            />
          </div>

          <div className="cell p-5" data-testid="chart-memory">
            <div className="flex items-center justify-between mb-3">
              <div className="label flex items-center gap-2"><MemoryStick className="w-3.5 h-3.5" /> Memory · live</div>
              <div className="mono text-xs text-[var(--muted)]">
                {cpuRamBlocked ? "—" : `${(latest?.memory ?? 0).toFixed(1)} %`}
              </div>
            </div>
            <MiniChart
              data={history}
              dataKey="memory"
              color="#7C3AED"
              formatter={(v) => `${v}%`}
              tooltip={<PercentTooltip />}
              unit="%"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="bw-charts">
          <div className="cell p-5" data-testid="chart-bandwidth-in">
            <div className="flex items-center justify-between mb-3">
              <div className="label flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-blue-600" /> Bandwidth IN · live</div>
              <div className="mono text-xs text-[var(--muted)]">{fmtBitrate(latest?.bandwidth_in_bps ?? 0)}</div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={history} margin={{ top: 5, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-bw-in-only" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={fmtTime} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} minTickGap={40} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={56}
                  tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v)} />
                <Tooltip content={<BwTooltip />} />
                <Area type="monotone" dataKey="bandwidth_in" name="in" stroke="#2563EB" strokeWidth={2.2}
                  fill="url(#grad-bw-in-only)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="cell p-5" data-testid="chart-bandwidth-out">
            <div className="flex items-center justify-between mb-3">
              <div className="label flex items-center gap-2"><Activity className="w-3.5 h-3.5 text-emerald-600" /> Bandwidth OUT · live</div>
              <div className="mono text-xs text-[var(--muted)]">{fmtBitrate(latest?.bandwidth_out_bps ?? 0)}</div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={history} margin={{ top: 5, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-bw-out-only" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16A34A" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="ts" tick={TICK} tickFormatter={fmtTime} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} minTickGap={40} />
                <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={56}
                  tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v)} />
                <Tooltip content={<BwTooltip />} />
                <Area type="monotone" dataKey="bandwidth_out" name="out" stroke="#16A34A" strokeWidth={2.2}
                  fill="url(#grad-bw-out-only)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Combined IN vs OUT — overlay both lines so the operator can read the
            cache-hit / amplification ratio at a glance. The fill is intentionally
            light so the lines stay readable when they overlap. */}
        <div className="cell p-5" data-testid="chart-bandwidth-combined">
          <div className="flex items-center justify-between mb-3">
            <div className="label flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" /> Bandwidth IN vs OUT · live
            </div>
            <div className="mono text-xs flex items-center gap-3">
              <span className="text-blue-600">▮ in {fmtBitrate(latest?.bandwidth_in_bps ?? 0)}</span>
              <span className="text-emerald-600">▮ out {fmtBitrate(latest?.bandwidth_out_bps ?? 0)}</span>
              <span className="text-[var(--muted)]">
                ratio {(() => {
                  const i = Number(latest?.bandwidth_in_bps) || 0;
                  const o = Number(latest?.bandwidth_out_bps) || 0;
                  if (i <= 0) return "—";
                  return `${(o / i).toFixed(2)}×`;
                })()}
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={history} margin={{ top: 5, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-bw-in-combined" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-bw-out-combined" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16A34A" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="ts" tick={TICK} tickFormatter={fmtTime} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} minTickGap={40} />
              <YAxis tick={TICK} axisLine={{ stroke: "#E5E7EB" }} tickLine={false} width={56}
                tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v)} />
              <Tooltip content={<BwTooltip />} />
              <Area type="monotone" dataKey="bandwidth_in" name="in" stroke="#2563EB" strokeWidth={2}
                fill="url(#grad-bw-in-combined)" isAnimationActive={false} />
              <Area type="monotone" dataKey="bandwidth_out" name="out" stroke="#16A34A" strokeWidth={2}
                fill="url(#grad-bw-out-combined)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="cell p-5" data-testid="chart-viewers">
          <div className="flex items-center justify-between mb-3">
            <div className="label flex items-center gap-2"><Users className="w-3.5 h-3.5" /> Viewers · live</div>
            <div className="mono text-xs text-[var(--muted)]">{latest?.clients ?? 0} active</div>
          </div>
          <MiniChart
            data={history}
            dataKey="clients"
            color="#F59E0B"
            formatter={(v) => v}
            tooltip={<PercentTooltip />}
          />
        </div>

        <div className="text-[11px] mono text-[var(--muted)] text-center" data-testid="monitor-meta">
          refreshing every {REFRESH_MS / 1000}s · {history.length}/{MAX_POINTS} samples ·{" "}
          mode: <span className="text-[var(--text)]">{latest?.mode || "—"}</span>
          {paused && <span className="ml-2 text-[var(--error)]">· paused</span>}
        </div>
      </div>
    </div>
  );
}
