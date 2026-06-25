import { useCallback, useEffect, useState } from "react";
import api, { fmtBitrate, fmtBytes, timeAgo } from "../api";
import PageHeader from "../components/PageHeader";

const PROTO_STYLE = {
  hls:    "bg-blue-50 text-blue-700 border-blue-200",
  dash:   "bg-purple-50 text-purple-700 border-purple-200",
  rtmp:   "bg-amber-50 text-amber-700 border-amber-200",
  webrtc: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rtsp:   "bg-cyan-50 text-cyan-700 border-cyan-200",
};

export default function Sessions() {
  const [list, setList] = useState([]);
  const [proto, setProto] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/sessions");
      setList(r.data || []);
    } catch (e) {
      console.error("sessions load failed", e);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = proto ? list.filter((s) => s.protocol === proto) : list;
  const protos = [...new Set(list.map((s) => s.protocol))];

  const filterBtn = (val, lbl, tid) => (
    <button
      key={val || "all"}
      onClick={() => setProto(val)}
      data-testid={tid}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
        proto === val ? "bg-[var(--primary)] text-white" : "bg-[var(--surface)] text-[var(--text-2)] border border-[var(--border)] hover:border-[var(--primary)]"
      }`}
    >
      {lbl}
    </button>
  );

  return (
    <div data-testid="sessions-page">
      <PageHeader
        title="Live sessions"
        subtitle="Real-time playback monitor"
        testId="sessions-header"
        right={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--live-soft)] border border-[#BBF7D0]">
            <span className="dot dot-live" />
            <span className="text-xs font-semibold text-[#15803D]">{filtered.length} active</span>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {filterBtn("", "All protocols", "proto-filter-all")}
          {protos.map((p) => filterBtn(p, p.toUpperCase(), `proto-filter-${p}`))}
        </div>

        <div className="cell overflow-hidden" data-testid="sessions-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)]">
                <tr className="text-left label">
                  <th className="px-5 py-3 font-semibold">Session</th>
                  <th className="px-5 py-3 font-semibold">Stream</th>
                  <th className="px-5 py-3 font-semibold">Proto</th>
                  <th className="px-5 py-3 font-semibold">IP</th>
                  <th className="px-5 py-3 font-semibold">Country</th>
                  <th className="px-5 py-3 font-semibold">Client</th>
                  <th className="px-5 py-3 font-semibold">Bitrate</th>
                  <th className="px-5 py-3 font-semibold">Bytes</th>
                  <th className="px-5 py-3 font-semibold">Started</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((s) => (
                  <tr key={s.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors" data-testid={`session-row-${s.id}`}>
                    <td className="px-5 py-3 mono text-xs text-[var(--muted)]">{s.id}</td>
                    <td className="px-5 py-3 font-medium">{s.stream}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider ${PROTO_STYLE[s.protocol] || "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)]"}`}>{s.protocol}</span>
                    </td>
                    <td className="px-5 py-3 mono text-xs">{s.ip}</td>
                    <td className="px-5 py-3 mono text-xs">{s.country}</td>
                    <td className="px-5 py-3 text-xs text-[var(--muted)] max-w-[180px] truncate">{s.user_agent}</td>
                    <td className="px-5 py-3 mono font-semibold">{fmtBitrate(s.bitrate)}</td>
                    <td className="px-5 py-3 mono text-[var(--muted)]">{fmtBytes(s.bytes)}</td>
                    <td className="px-5 py-3 mono text-xs text-[var(--muted)]">{timeAgo(s.started_at)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-5 py-14 text-center text-[var(--muted)]">No active sessions.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
