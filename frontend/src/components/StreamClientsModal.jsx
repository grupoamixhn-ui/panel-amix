import { useEffect, useState } from "react";
import api, { fmtBitrate, fmtBytes, timeAgo } from "../api";
import { X, Users } from "lucide-react";

const PROTO_BADGE = {
  hls:    "bg-blue-50 text-blue-700 border-blue-200",
  dash:   "bg-purple-50 text-purple-700 border-purple-200",
  rtmp:   "bg-amber-50 text-amber-700 border-amber-200",
  srt:    "bg-rose-50 text-rose-700 border-rose-200",
  webrtc: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rtsp:   "bg-cyan-50 text-cyan-700 border-cyan-200",
};

export default function StreamClientsModal({ streamName, onClose }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const r = await api.get(`/streams/${streamName}/sessions`);
      setList(r.data || []);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [streamName]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="stream-clients-modal">
      <div className="w-full max-w-4xl bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--border)] relative max-h-[90vh] flex flex-col">
        <button onClick={onClose} className="absolute top-5 right-5 text-[var(--muted)] hover:text-[var(--text)]" data-testid="stream-clients-close">
          <X className="w-4 h-4" />
        </button>

        <div className="px-7 pt-7 pb-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <div className="label mb-1">Connected clients</div>
            <h3 className="text-xl font-semibold tracking-tight">{streamName}</h3>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--live-soft)] border border-[#BBF7D0]">
            <Users className="w-3.5 h-3.5 text-[#15803D]" />
            <span className="text-xs font-semibold text-[#15803D]">{list?.length ?? 0} active</span>
          </div>
        </div>

        <div className="overflow-y-auto">
          {err && <div className="m-5 px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>}

          {list === null && !err && <div className="p-10 text-center text-[var(--muted)] text-sm">Loading clients…</div>}

          {list && list.length === 0 && (
            <div className="p-10 text-center text-[var(--muted)] text-sm">No active clients on this stream.</div>
          )}

          {list && list.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] sticky top-0">
                <tr className="text-left label">
                  <th className="px-5 py-3 font-semibold">Proto</th>
                  <th className="px-5 py-3 font-semibold">IP address</th>
                  <th className="px-5 py-3 font-semibold">Country</th>
                  <th className="px-5 py-3 font-semibold">Bitrate</th>
                  <th className="px-5 py-3 font-semibold">Bytes</th>
                  <th className="px-5 py-3 font-semibold">Started</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors" data-testid={`client-row-${s.id}`}>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider ${PROTO_BADGE[s.protocol] || "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)]"}`}>{s.protocol}</span>
                    </td>
                    <td className="px-5 py-3 mono text-xs">{s.ip || "—"}</td>
                    <td className="px-5 py-3 mono text-xs">{s.country || "—"}</td>
                    <td className="px-5 py-3 mono font-semibold">{fmtBitrate(s.bitrate)}</td>
                    <td className="px-5 py-3 mono text-[var(--muted)]">{fmtBytes(s.bytes)}</td>
                    <td className="px-5 py-3 mono text-xs text-[var(--muted)]">{timeAgo(s.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-7 py-4 border-t border-[var(--border)] flex justify-end bg-[var(--surface-2)] rounded-b-2xl">
          <button onClick={onClose} className="btn btn-primary" data-testid="stream-clients-done">Done</button>
        </div>
      </div>
    </div>
  );
}
