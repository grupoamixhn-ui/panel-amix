import { useCallback, useEffect, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "../components/PageHeader";
import StreamWizard from "../components/StreamWizard";
import OutputsModal from "../components/OutputsModal";
import StreamClientsModal from "../components/StreamClientsModal";
import { Plus, Play, Pause, Trash2, Share2, Search, Pencil, Users, RotateCw } from "lucide-react";

function statusPill(s) {
  if (s.alive) return <span className="pill pill-live"><span className="dot dot-live" />Live</span>;
  if (s.status === "error") return <span className="pill pill-error">Error</span>;
  return <span className="pill pill-off">Idle</span>;
}

export default function Streams() {
  const [streams, setStreams] = useState([]);
  const [q, setQ] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [outputsFor, setOutputsFor] = useState(null);
  const [clientsFor, setClientsFor] = useState(null);
  const [resetting, setResetting] = useState({});  // {streamName: true}

  const load = useCallback(async () => {
    try {
      const r = await api.get("/streams");
      setStreams(r.data || []);
    } catch (e) {
      console.error("streams load failed", e);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async (name, start) => {
    await api.post(`/streams/${name}/toggle`, { start });
    load();
  };

  const del = async (name) => {
    if (!window.confirm(`Delete stream "${name}"?`)) return;
    await api.delete(`/streams/${name}`);
    load();
  };

  const reset = async (name) => {
    if (!window.confirm(`Reset stream "${name}"?\n\nThis will disconnect current viewers and force Flussonic to reconnect to the source.`)) return;
    setResetting((r) => ({ ...r, [name]: true }));
    try {
      await api.post(`/streams/${name}/reset`);
      // Small delay so Flussonic surfaces fresh state
      setTimeout(load, 1200);
    } catch (e) {
      console.error("reset failed", e);
      window.alert(`Failed to reset "${name}": ${e?.response?.data?.detail || e.message}`);
    } finally {
      setResetting((r) => { const n = { ...r }; delete n[name]; return n; });
    }
  };

  const filtered = streams.filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    (s.inputs?.[0]?.url || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div data-testid="streams-page">
      <PageHeader
        title="Streams"
        subtitle="Ingest & publish"
        testId="streams-header"
        right={
          <button
            onClick={() => { setEditing(null); setWizardOpen(true); }}
            className="btn btn-primary"
            data-testid="new-stream-button"
          >
            <Plus className="w-4 h-4" /> New stream
          </button>
        }
      />

      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              data-testid="streams-search"
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search streams or sources…"
              className="w-full pl-10 pr-3 py-2.5 text-sm"
            />
          </div>
          <div className="text-xs text-[var(--muted)] mono">{filtered.length} of {streams.length}</div>
        </div>

        <div className="cell overflow-hidden" data-testid="streams-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)]">
                <tr className="text-left label">
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Name</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 font-semibold">Viewers</th>
                  <th className="px-5 py-3 font-semibold">Bitrate</th>
                  <th className="px-5 py-3 font-semibold">Uptime</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.name} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors" data-testid={`stream-row-${s.name}`}>
                    <td className="px-5 py-3.5">{statusPill(s)}</td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => { setEditing(s); setWizardOpen(true); }} className="font-medium hover:text-[var(--primary)] transition-colors" data-testid={`stream-edit-${s.name}`}>
                        {s.name}
                      </button>
                      {s.title && <div className="text-xs text-[var(--muted)]">{s.title}</div>}
                    </td>
                    <td className="px-5 py-3.5 mono text-xs text-[var(--muted)] max-w-xs truncate" data-testid={`stream-source-${s.name}`}>
                      {(() => {
                        const url = s.inputs?.[0]?.url || "";
                        const isPublish = url.startsWith("publish://");
                        if (isPublish && s.publisher_ip) {
                          const proto = (s.publisher_proto || "").toUpperCase();
                          const badgeColor = proto === "RTMP" ? "bg-orange-50 text-orange-700 border-orange-200"
                            : proto === "SRT" ? "bg-purple-50 text-purple-700 border-purple-200"
                            : "bg-slate-50 text-slate-700 border-slate-200";
                          return (
                            <span className="flex items-center gap-1.5">
                              <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded border font-semibold tracking-wider ${badgeColor}`}>{proto || "PUSH"}</span>
                              <span className="text-[var(--text-2)]" title={`Publisher IP: ${s.publisher_ip}`}>{s.publisher_ip}</span>
                            </span>
                          );
                        }
                        if (isPublish) {
                          return <span className="italic text-[var(--muted)]">publish:// <span className="text-[10px]">(no publisher connected)</span></span>;
                        }
                        return url;
                      })()}
                    </td>
                    <td className="px-5 py-3.5 mono font-semibold">
                      {s.clients > 0 ? (
                        <button
                          onClick={() => setClientsFor(s.name)}
                          className="hover:text-[var(--primary)] underline-offset-2 hover:underline"
                          title="View connected clients"
                          data-testid={`stream-viewers-${s.name}`}
                        >
                          {s.clients.toLocaleString()}
                        </button>
                      ) : s.clients.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 mono">{fmtBitrate(s.bitrate)}</td>
                    <td className="px-5 py-3.5 mono text-[var(--muted)]">{fmtUptime(s.uptime)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => setClientsFor(s.name)}
                          className="btn-icon"
                          title="Connected clients"
                          data-testid={`stream-clients-${s.name}`}
                        >
                          <Users className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setOutputsFor(s.name)}
                          className="btn-icon"
                          title="Output URLs (HLS / RTMP / SRT)"
                          data-testid={`stream-outputs-${s.name}`}
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggle(s.name, !s.alive)}
                          className="btn-icon"
                          title={s.alive ? "Stop" : "Start"}
                          data-testid={`stream-toggle-${s.name}`}
                        >
                          {s.alive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => reset(s.name)}
                          disabled={!!resetting[s.name]}
                          className="btn-icon"
                          title="Reset (kick viewers + reconnect source)"
                          data-testid={`stream-reset-${s.name}`}
                        >
                          <RotateCw className={`w-3.5 h-3.5 ${resetting[s.name] ? "animate-spin" : ""}`} />
                        </button>
                        <button
                          onClick={() => { setEditing(s); setWizardOpen(true); }}
                          className="btn-icon"
                          title="Edit"
                          data-testid={`stream-edit-icon-${s.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => del(s.name)}
                          className="btn-icon btn-icon-danger"
                          title="Delete"
                          data-testid={`stream-delete-${s.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-14 text-center text-[var(--muted)]">No streams found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {wizardOpen && (
        <StreamWizard
          initial={editing}
          onClose={() => setWizardOpen(false)}
          onSaved={(name) => { setWizardOpen(false); load(); setOutputsFor(name); }}
          onDeleted={() => { setWizardOpen(false); load(); }}
        />
      )}

      {outputsFor && (
        <OutputsModal streamName={outputsFor} onClose={() => setOutputsFor(null)} />
      )}

      {clientsFor && (
        <StreamClientsModal streamName={clientsFor} onClose={() => setClientsFor(null)} />
      )}
    </div>
  );
}
