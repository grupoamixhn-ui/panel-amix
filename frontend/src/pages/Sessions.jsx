import { useEffect, useState } from "react";
import api, { fmtBitrate, fmtBytes, timeAgo } from "../api";
import PageHeader from "../components/PageHeader";

const PROTO_COLORS = {
  hls: "text-[var(--primary)]",
  dash: "text-[#A855F7]",
  rtmp: "text-[var(--warn)]",
  webrtc: "text-[var(--live)]",
  rtsp: "text-[#06B6D4]",
};

export default function Sessions() {
  const [list, setList] = useState([]);
  const [proto, setProto] = useState("");

  const load = async () => {
    try {
      const r = await api.get("/sessions");
      setList(r.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const filtered = proto ? list.filter((s) => s.protocol === proto) : list;
  const protos = [...new Set(list.map((s) => s.protocol))];

  return (
    <div data-testid="sessions-page">
      <PageHeader
        title="Live Sessions"
        subtitle="REAL-TIME PLAYBACK MONITOR"
        testId="sessions-header"
        right={
          <div className="flex items-center gap-3 mono text-xs">
            <span className="dot dot-live" />
            <span className="text-[var(--muted)]">{filtered.length} active</span>
          </div>
        }
      />

      <div className="p-8 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setProto("")} className={`px-3 py-1 text-xs border ${proto === "" ? "border-[var(--primary)] text-white" : "border-[var(--border)] text-[var(--muted)]"} mono uppercase`} data-testid="proto-filter-all">All</button>
          {protos.map((p) => (
            <button key={p} onClick={() => setProto(p)} className={`px-3 py-1 text-xs border ${proto === p ? "border-[var(--primary)] text-white" : "border-[var(--border)] text-[var(--muted)]"} mono uppercase`} data-testid={`proto-filter-${p}`}>{p}</button>
          ))}
        </div>

        <div className="cell overflow-x-auto" data-testid="sessions-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left label border-b border-[var(--border)]">
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Stream</th>
                <th className="px-4 py-3">Proto</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Bitrate</th>
                <th className="px-4 py-3">Bytes</th>
                <th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)] cell-hover" data-testid={`session-row-${s.id}`}>
                  <td className="px-4 py-3 mono text-xs text-[var(--muted)]">{s.id}</td>
                  <td className="px-4 py-3 font-medium">{s.stream}</td>
                  <td className={`px-4 py-3 mono text-xs uppercase ${PROTO_COLORS[s.protocol] || ""}`}>{s.protocol}</td>
                  <td className="px-4 py-3 mono text-xs">{s.ip}</td>
                  <td className="px-4 py-3 mono text-xs">{s.country}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)] max-w-[180px] truncate">{s.user_agent}</td>
                  <td className="px-4 py-3 mono">{fmtBitrate(s.bitrate)}</td>
                  <td className="px-4 py-3 mono text-[var(--muted)]">{fmtBytes(s.bytes)}</td>
                  <td className="px-4 py-3 mono text-xs text-[var(--muted)]">{timeAgo(s.started_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--muted)]">No active sessions.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
