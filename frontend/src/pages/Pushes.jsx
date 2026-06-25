import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";
import PushTargetsModal from "../components/PushTargetsModal";
import {
  Send, Plus, Trash2, Search, CheckCircle2, RefreshCw, Youtube, Facebook,
  Music2, Instagram, RadioTower, Twitch,
} from "lucide-react";

const TPL_ICON = {
  YouTube: { icon: Youtube, color: "text-red-600", bg: "bg-red-50 border-red-200" },
  Facebook: { icon: Facebook, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
  TikTok: { icon: Music2, color: "text-fuchsia-600", bg: "bg-fuchsia-50 border-fuchsia-200" },
  Instagram: { icon: Instagram, color: "text-pink-600", bg: "bg-pink-50 border-pink-200" },
  Twitch: { icon: Twitch, color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
};
const DEFAULT_TPL = { icon: RadioTower, color: "text-slate-600", bg: "bg-slate-50 border-slate-200" };

function templateOf(label) { return TPL_ICON[label] || DEFAULT_TPL; }

export default function Pushes() {
  const [pushes, setPushes] = useState([]);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [modalFor, setModalFor] = useState(null);
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        api.get("/pushes"),
        api.get("/streams"),
      ]);
      setPushes(p.data || []);
      setStreams(s.data || []);
    } catch (e) {
      console.error("pushes load failed", e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const platforms = useMemo(() => {
    const set = new Set(pushes.map((p) => p.label || "Custom"));
    return Array.from(set).sort();
  }, [pushes]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pushes.filter((p) => {
      if (filter !== "all" && (p.label || "Custom") !== filter) return false;
      if (!term) return true;
      return (
        (p.stream || "").toLowerCase().includes(term) ||
        (p.url || "").toLowerCase().includes(term) ||
        (p.label || "").toLowerCase().includes(term)
      );
    });
  }, [pushes, filter, q]);

  const remove = async (p) => {
    if (!window.confirm(`Remove push from "${p.stream}" → ${p.url} ?`)) return;
    const key = `${p.stream}::${p.url}`;
    setBusyKey(key);
    try {
      await api.delete(`/streams/${encodeURIComponent(p.stream)}/pushes`, { params: { url: p.url } });
      await load();
    } catch (e) {
      window.alert(e?.response?.data?.detail || e.message);
    } finally { setBusyKey(""); }
  };

  const aliveStreams = streams.filter((s) => s.alive).length;
  const activePushes = filtered.filter((p) => p.active).length;

  return (
    <div data-testid="pushes-page">
      <PageHeader
        title="Social pushes"
        subtitle="Broadcast streams to YouTube, Facebook, TikTok & RTMP"
        testId="pushes-header"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="btn-icon"
              title="Refresh"
              data-testid="pushes-refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--live-soft)] border border-[#BBF7D0]">
              <span className="dot dot-live" />
              <span className="text-xs font-semibold text-[#15803D]">{activePushes} active</span>
            </div>
          </div>
        }
      />

      <div className="p-4 md:p-8 space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="cell p-4">
            <div className="label mb-1">Streams in scope</div>
            <div className="text-2xl font-semibold mono" data-testid="kpi-streams-scope">{streams.length}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{aliveStreams} live</div>
          </div>
          <div className="cell p-4">
            <div className="label mb-1">Total push targets</div>
            <div className="text-2xl font-semibold mono" data-testid="kpi-pushes-total">{pushes.length}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">across {new Set(pushes.map((p) => p.stream)).size} streams</div>
          </div>
          <div className="cell p-4">
            <div className="label mb-1">Active right now</div>
            <div className="text-2xl font-semibold mono text-[var(--live)]" data-testid="kpi-pushes-active">{pushes.filter((p) => p.active).length}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">Flussonic-reported</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              data-testid="pushes-search"
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search stream, URL or platform…"
              className="w-full pl-10 pr-3 py-2.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilter("all")}
              data-testid="pushes-filter-all"
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg border transition ${filter === "all" ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"}`}
            >All</button>
            {platforms.map((lbl) => {
              const t = templateOf(lbl);
              const Ic = t.icon;
              const active = filter === lbl;
              return (
                <button
                  key={lbl}
                  onClick={() => setFilter(lbl)}
                  data-testid={`pushes-filter-${lbl.toLowerCase()}`}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-lg border flex items-center gap-1.5 transition ${
                    active ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
                  }`}
                >
                  <Ic className={`w-3.5 h-3.5 ${active ? "" : t.color}`} /> {lbl}
                </button>
              );
            })}
          </div>
        </div>

        {/* Pushes table */}
        <div className="cell overflow-hidden" data-testid="pushes-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)]">
                <tr className="text-left label">
                  <th className="px-5 py-3 font-semibold">Platform</th>
                  <th className="px-5 py-3 font-semibold">Stream</th>
                  <th className="px-5 py-3 font-semibold">Destination URL</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => {
                  const t = templateOf(p.label);
                  const Ic = t.icon;
                  const key = `${p.stream}::${p.url}`;
                  return (
                    <tr key={`${key}-${idx}`} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]" data-testid={`push-row-${p.stream}`}>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-semibold ${t.bg}`}>
                          <Ic className={`w-3 h-3 ${t.color}`} /> {p.label || "Custom"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{p.stream}</div>
                        {p.stream_title && <div className="text-[11px] text-[var(--muted)]">{p.stream_title}</div>}
                      </td>
                      <td className="px-5 py-3 mono text-[11px] text-[var(--muted)] max-w-md truncate" title={p.url}>{p.url}</td>
                      <td className="px-5 py-3">
                        {p.active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold uppercase tracking-wider">
                            <CheckCircle2 className="w-3 h-3" /> Live
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--muted)]">Idle</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => setModalFor(p.stream)}
                            className="btn-icon"
                            title="Manage pushes for this stream"
                            data-testid={`push-manage-${p.stream}`}
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => remove(p)}
                            disabled={busyKey === key}
                            className="btn-icon btn-icon-danger"
                            title="Remove"
                            data-testid={`push-remove-${p.stream}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={5} className="px-5 py-14 text-center text-[var(--muted)] text-sm">No push targets configured.</td></tr>
                )}
                {loading && filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-14 text-center text-[var(--muted)] text-sm">Loading push targets…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add per stream */}
        <div className="cell p-5">
          <div className="label mb-3">Add a push for a stream</div>
          <div className="flex items-center gap-2 flex-wrap">
            {streams.length === 0 && (
              <div className="text-xs text-[var(--muted)]">No streams in scope.</div>
            )}
            {streams.map((s) => (
              <button
                key={s.name}
                onClick={() => setModalFor(s.name)}
                data-testid={`push-add-for-${s.name}`}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition inline-flex items-center gap-1.5"
              >
                <Plus className="w-3 h-3" /> {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {modalFor && (
        <PushTargetsModal
          streamName={modalFor}
          onClose={() => { setModalFor(null); load(); }}
        />
      )}
    </div>
  );
}
