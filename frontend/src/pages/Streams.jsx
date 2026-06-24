import { useEffect, useState } from "react";
import api, { fmtBitrate, fmtUptime } from "../api";
import PageHeader from "../components/PageHeader";
import { Plus, Play, Pause, Trash2, X, Search } from "lucide-react";

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
    } catch (e) {
      const m = e.response?.data?.detail;
      setErr(typeof m === "string" ? m : "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" data-testid="stream-form-modal">
      <form onSubmit={submit} className="w-full max-w-lg cell p-6 relative">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 text-[var(--muted)] hover:text-white" data-testid="stream-form-close">
          <X className="w-4 h-4" />
        </button>
        <div className="label mb-1">{editing ? "Modify Stream" : "New Stream"}</div>
        <h3 className="text-xl font-semibold mb-6">{editing ? name : "Configure ingest"}</h3>

        {!editing && (
          <>
            <label className="label">Name</label>
            <input
              data-testid="stream-form-name"
              value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              required
              className="w-full mt-2 mb-4 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--primary)] mono text-sm"
            />
          </>
        )}

        <label className="label">Source URL</label>
        <input
          data-testid="stream-form-url"
          value={url} onChange={(e) => setUrl(e.target.value)}
          required placeholder="rtsp://… / udp://… / rtmp://…"
          className="w-full mt-2 mb-4 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--primary)] mono text-sm"
        />

        <label className="label">Title</label>
        <input
          data-testid="stream-form-title"
          value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full mt-2 mb-4 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--primary)] text-sm"
        />

        <label className="flex items-center gap-2 mt-2 mb-6 text-sm cursor-pointer" data-testid="stream-form-dvr">
          <input type="checkbox" checked={dvr} onChange={(e) => setDvr(e.target.checked)} />
          <span>Enable DVR archive</span>
        </label>

        {err && <div className="mb-4 text-xs text-[var(--error)] mono">{err}</div>}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-[var(--border)] hover:bg-[var(--surface-2)]" data-testid="stream-form-cancel">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="px-4 py-2 text-sm bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white disabled:opacity-50" data-testid="stream-form-submit">
            {busy ? "Saving…" : editing ? "Save" : "Create stream"}
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

  const load = async () => {
    try {
      const r = await api.get("/streams");
      setStreams(r.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

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
        subtitle="INGEST & PUBLISH"
        testId="streams-header"
        right={
          <button
            onClick={() => { setEditing(null); setOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm transition-colors"
            data-testid="new-stream-button"
          >
            <Plus className="w-4 h-4" /> New Stream
          </button>
        }
      />

      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              data-testid="streams-search"
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search streams or sources…"
              className="w-full pl-10 pr-3 py-2 bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--primary)] text-sm"
            />
          </div>
          <div className="text-xs text-[var(--muted)] mono">{filtered.length} of {streams.length}</div>
        </div>

        <div className="cell overflow-x-auto" data-testid="streams-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left label border-b border-[var(--border)]">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Viewers</th>
                <th className="px-4 py-3">Bitrate</th>
                <th className="px-4 py-3">Uptime</th>
                <th className="px-4 py-3">DVR</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.name} className="border-b border-[var(--border)] cell-hover" data-testid={`stream-row-${s.name}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`dot ${s.alive ? "dot-live" : s.status === "error" ? "dot-error" : "dot-offline"}`} />
                      <span className="text-xs mono uppercase">{s.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setEditing(s); setOpen(true); }} className="font-medium hover:text-[var(--primary)]" data-testid={`stream-edit-${s.name}`}>
                      {s.name}
                    </button>
                    {s.title && <div className="text-xs text-[var(--muted)]">{s.title}</div>}
                  </td>
                  <td className="px-4 py-3 mono text-xs text-[var(--muted)] max-w-xs truncate">{s.inputs?.[0]?.url}</td>
                  <td className="px-4 py-3 mono">{s.clients}</td>
                  <td className="px-4 py-3 mono">{fmtBitrate(s.bitrate)}</td>
                  <td className="px-4 py-3 mono text-[var(--muted)]">{fmtUptime(s.uptime)}</td>
                  <td className="px-4 py-3 text-xs mono">{s.dvr_enabled ? "ON" : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => toggle(s.name, !s.alive)}
                        className="p-1.5 border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                        title={s.alive ? "Stop" : "Start"}
                        data-testid={`stream-toggle-${s.name}`}
                      >
                        {s.alive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => del(s.name)}
                        className="p-1.5 border border-[var(--border)] hover:border-[var(--error)] hover:text-[var(--error)] transition-colors"
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
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--muted)]">No streams found.</td></tr>
              )}
            </tbody>
          </table>
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
