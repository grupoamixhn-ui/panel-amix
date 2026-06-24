import { useCallback, useEffect, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "../components/PageHeader";
import { Plus, Play, Pause, Trash2, X, Search } from "lucide-react";

function statusPill(s) {
  if (s.alive) return <span className="pill pill-live"><span className="dot dot-live" />Live</span>;
  if (s.status === "error") return <span className="pill pill-error">Error</span>;
  return <span className="pill pill-off">Idle</span>;
}

function StreamForm({ initial, onClose, onSaved }) {
  const editing = !!initial?.name;
  const [name, setName] = useState(initial?.name || "");
  const [url, setUrl] = useState(initial?.inputs?.[0]?.url || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [dvr, setDvr] = useState(!!initial?.dvr_enabled);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (editing) {
        await api.put(`/streams/${name}`, { url, title, dvr });
      } else {
        await api.post("/streams", { name, url, title, dvr });
      }
      onSaved();
    } catch (e2) {
      const m = e2.response?.data?.detail;
      setErr(typeof m === "string" ? m : "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="stream-form-modal">
      <form onSubmit={submit} className="w-full max-w-lg bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] p-7 relative border border-[var(--border)]">
        <button type="button" onClick={onClose} className="absolute top-5 right-5 text-[var(--muted)] hover:text-[var(--text)] transition-colors" data-testid="stream-form-close">
          <X className="w-4 h-4" />
        </button>
        <div className="label mb-1">{editing ? "Modify stream" : "New stream"}</div>
        <h3 className="text-xl font-semibold mb-6 tracking-tight">{editing ? name : "Configure ingest"}</h3>

        {!editing && (
          <>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Name</label>
            <input
              data-testid="stream-form-name"
              value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              required placeholder="my_stream"
              className="w-full px-3.5 py-2.5 mb-4 mono text-sm"
            />
          </>
        )}

        <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Source URL</label>
        <input
          data-testid="stream-form-url"
          value={url} onChange={(e) => setUrl(e.target.value)}
          required placeholder="rtsp://… / srt://… / udp://… / rtmp://…"
          className="w-full px-3.5 py-2.5 mb-4 mono text-sm"
        />

        <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Title</label>
        <input
          data-testid="stream-form-title"
          value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Friendly name"
          className="w-full px-3.5 py-2.5 mb-4 text-sm"
        />

        <label className="flex items-center gap-2.5 mt-3 mb-7 text-sm cursor-pointer select-none" data-testid="stream-form-dvr">
          <input type="checkbox" checked={dvr} onChange={(e) => setDvr(e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
          <span>Enable DVR archive</span>
        </label>

        {err && <div className="mb-4 px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn btn-ghost" data-testid="stream-form-cancel">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary" data-testid="stream-form-submit">
            {busy ? "Saving…" : editing ? "Save changes" : "Create stream"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Streams() {
  const [streams, setStreams] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

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
            onClick={() => { setEditing(null); setOpen(true); }}
            className="btn btn-primary"
            data-testid="new-stream-button"
          >
            <Plus className="w-4 h-4" /> New stream
          </button>
        }
      />

      <div className="p-8 space-y-4">
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
                  <th className="px-5 py-3 font-semibold">DVR</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.name} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors" data-testid={`stream-row-${s.name}`}>
                    <td className="px-5 py-3.5">{statusPill(s)}</td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => { setEditing(s); setOpen(true); }} className="font-medium hover:text-[var(--primary)] transition-colors" data-testid={`stream-edit-${s.name}`}>
                        {s.name}
                      </button>
                      {s.title && <div className="text-xs text-[var(--muted)]">{s.title}</div>}
                    </td>
                    <td className="px-5 py-3.5 mono text-xs text-[var(--muted)] max-w-xs truncate">{s.inputs?.[0]?.url}</td>
                    <td className="px-5 py-3.5 mono font-semibold">{s.clients.toLocaleString()}</td>
                    <td className="px-5 py-3.5 mono">{fmtBitrate(s.bitrate)}</td>
                    <td className="px-5 py-3.5 mono text-[var(--muted)]">{fmtUptime(s.uptime)}</td>
                    <td className="px-5 py-3.5 text-xs">
                      {s.dvr_enabled
                        ? <span className="pill pill-live">ON</span>
                        : <span className="pill pill-off">OFF</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => toggle(s.name, !s.alive)}
                          className="btn-icon"
                          title={s.alive ? "Stop" : "Start"}
                          data-testid={`stream-toggle-${s.name}`}
                        >
                          {s.alive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
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
                  <tr><td colSpan={8} className="px-5 py-14 text-center text-[var(--muted)]">No streams found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {open && (
        <StreamForm
          initial={editing}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); load(); }}
        />
      )}
    </div>
  );
}
