import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";
import HlsPlayer from "../components/HlsPlayer";
import { Film, Folder, FolderOpen, Play, ChevronRight, RefreshCw, Search, Copy, Check, X, ExternalLink, Info } from "lucide-react";

function fmtSize(bytes) {
  if (!bytes) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function CopyBtn({ text, id }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };
  return (
    <button onClick={copy} className={`btn-icon ${copied ? "text-[var(--live)] border-[var(--live)]" : ""}`} title="Copy" data-testid={`vod-copy-${id}`}>
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function Vod() {
  const [locations, setLocations] = useState([]);
  const [active, setActive] = useState(null);              // {name, storage, urlprefix}
  const [path, setPath] = useState("");                    // subpath inside the VOD
  const [files, setFiles] = useState({ entries: [], supported: true });
  const [selected, setSelected] = useState(null);          // file path of selected
  const [playback, setPlayback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [filter, setFilter] = useState("");

  const loadLocations = useCallback(async () => {
    setErr("");
    try {
      const r = await api.get("/vod/locations");
      setLocations(r.data || []);
      if ((r.data || []).length > 0 && !active) setActive(r.data[0]);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    }
  }, [active]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  // Load files when active VOD or path changes
  useEffect(() => {
    if (!active?.name) return;
    setLoading(true); setSelected(null); setPlayback(null);
    api.get(`/vod/locations/${encodeURIComponent(active.name)}/files`, { params: { path } })
      .then((r) => setFiles(r.data || { entries: [], supported: false }))
      .catch((e) => setErr(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [active, path]);

  const loadPlayback = useCallback(async (filePath) => {
    if (!active?.name || !filePath) return;
    setSelected(filePath); setPlayback(null);
    try {
      const r = await api.get(`/vod/locations/${encodeURIComponent(active.name)}/playback`, { params: { file: filePath } });
      setPlayback(r.data);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    }
  }, [active]);

  const enterDir = (entryName) => {
    setPath((p) => (p ? `${p.replace(/\/$/, "")}/${entryName}` : entryName));
  };
  const goUp = () => {
    setPath((p) => p.split("/").slice(0, -1).join("/"));
  };
  const breadcrumbs = useMemo(() => {
    if (!path) return [];
    const parts = path.split("/").filter(Boolean);
    return parts.map((p, i) => ({ name: p, full: parts.slice(0, i + 1).join("/") }));
  }, [path]);

  const visibleEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = files.entries || [];
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  }, [files, filter]);

  const hlsUrl = useMemo(() => {
    if (!playback?.outputs) return "";
    const h = playback.outputs.find((o) => o.url.endsWith("/index.m3u8"));
    return h?.url || "";
  }, [playback]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto" data-testid="vod-page">
      <PageHeader
        title="VOD library"
        subtitle="Browse the files in your Flussonic VOD locations and grab on-demand playback URLs"
        actions={
          <button onClick={loadLocations} className="btn btn-secondary" data-testid="vod-refresh">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        }
      />

      {err && (
        <div className="px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs mb-4" data-testid="vod-error">
          {err}
        </div>
      )}

      {locations.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          {/* Locations sidebar */}
          <aside className="space-y-2" data-testid="vod-locations">
            <div className="label mb-2">Locations</div>
            {locations.map((l) => (
              <button
                key={l.name}
                onClick={() => { setActive(l); setPath(""); }}
                data-testid={`vod-location-${l.name}`}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                  active?.name === l.name
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] ring-1 ring-[var(--primary)]/30"
                    : "border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--surface)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Film className={`w-3.5 h-3.5 ${active?.name === l.name ? "text-[var(--primary)]" : "text-[var(--muted)]"}`} />
                  <span className="text-xs font-semibold truncate">{l.name}</span>
                </div>
                {l.storage && <div className="text-[10px] text-[var(--muted)] mt-0.5 mono truncate" title={l.storage}>{l.storage}</div>}
              </button>
            ))}
          </aside>

          {/* Files + preview */}
          <main className="space-y-5">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <button onClick={() => setPath("")} className="text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1" data-testid="vod-breadcrumb-root">
                <Folder className="w-3.5 h-3.5" /> {active?.name}
              </button>
              {breadcrumbs.map((b) => (
                <span key={b.full} className="flex items-center gap-2">
                  <ChevronRight className="w-3 h-3 text-[var(--muted)]" />
                  <button onClick={() => setPath(b.full)} className="text-[var(--muted)] hover:text-[var(--text)]">{b.name}</button>
                </span>
              ))}
              {path && (
                <button onClick={goUp} className="ml-2 px-2 py-0.5 rounded-md border border-[var(--border)] text-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)]" data-testid="vod-up">
                  ↑ Up
                </button>
              )}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                data-testid="vod-search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter files…"
                className="w-full pl-9 pr-3 py-2 text-sm"
              />
            </div>

            {/* File list */}
            {!files.supported ? (
              <ManualEntry
                manualPath={manualPath}
                setManualPath={setManualPath}
                onSubmit={() => loadPlayback(manualPath)}
                vodName={active?.name}
              />
            ) : loading ? (
              <div className="text-xs text-[var(--muted)] py-6 text-center">Loading…</div>
            ) : visibleEntries.length === 0 ? (
              <div className="text-xs text-[var(--muted)] py-6 text-center" data-testid="vod-no-files">
                No files in this folder.
              </div>
            ) : (
              <ul className="rounded-lg border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]" data-testid="vod-file-list">
                {visibleEntries.map((e) => {
                  const full = path ? `${path}/${e.name}` : e.name;
                  const isSel = selected === full;
                  return (
                    <li key={full}>
                      <button
                        onClick={() => (e.type === "dir" ? enterDir(e.name) : loadPlayback(full))}
                        data-testid={`vod-entry-${e.name}`}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors ${isSel ? "bg-[var(--primary-soft)]" : ""}`}
                      >
                        {e.type === "dir" ? <FolderOpen className="w-4 h-4 text-amber-500" /> : <Film className="w-4 h-4 text-[var(--primary)]" />}
                        <span className="text-xs flex-1 truncate font-medium">{e.name}</span>
                        {e.type === "file" && <span className="text-[10px] mono text-[var(--muted)]">{fmtSize(e.size)}</span>}
                        {e.type === "file" && <Play className="w-3.5 h-3.5 text-[var(--muted)]" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Preview + URLs */}
            {playback && (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4" data-testid="vod-playback">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="label">Playback</div>
                    <div className="text-sm font-semibold truncate mono">{playback.file}</div>
                  </div>
                  <button onClick={() => { setPlayback(null); setSelected(null); }} className="text-[var(--muted)] hover:text-[var(--text)]" data-testid="vod-close-playback">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {hlsUrl && <HlsPlayer url={hlsUrl} />}
                <div className="space-y-2">
                  {playback.outputs.map((o) => (
                    <div key={o.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                      <span className="px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border-blue-200">
                        {o.protocol}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--text-2)] truncate">{o.label}</div>
                        <div className="mono text-[11px] text-[var(--muted)] truncate" title={o.url}>{o.url}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <a href={o.url} target="_blank" rel="noopener noreferrer" className="btn-icon" title="Open in new tab" data-testid={`vod-open-${o.protocol}`}>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <CopyBtn text={o.url} id={o.protocol} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-8 py-12 text-center max-w-2xl mx-auto" data-testid="vod-empty">
      <Film className="w-10 h-10 mx-auto text-[var(--muted)] mb-4" />
      <h3 className="text-lg font-semibold mb-2">No VOD locations configured</h3>
      <p className="text-sm text-[var(--muted)] leading-relaxed mb-5">
        Add a <span className="mono">vod</span> block to your <span className="mono">flussonic.conf</span> on the
        Media Server, then click <strong>Refresh</strong>.
      </p>
      <pre className="text-[11px] mono text-left bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 overflow-x-auto leading-relaxed">{`vod movies {
  storage /storage/vod;
  cache /cache;
}`}</pre>
      <p className="text-[11px] text-[var(--muted)] mt-3 flex items-center justify-center gap-1.5">
        <Info className="w-3 h-3" /> Reload Flussonic after editing the config.
      </p>
    </div>
  );
}

function ManualEntry({ manualPath, setManualPath, onSubmit, vodName }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-4" data-testid="vod-manual-entry">
      <div className="text-xs font-semibold mb-1">File listing not available</div>
      <p className="text-[11px] text-[var(--muted)] mb-3 leading-snug">
        Your Flussonic version does not expose a file scan API for the location
        <span className="mono"> {vodName}</span>. Enter the relative file path manually:
      </p>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex gap-2">
        <input
          data-testid="vod-manual-input"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          placeholder="e.g. action/movie.mp4"
          className="flex-1 px-3 py-2 text-sm mono"
        />
        <button type="submit" className="btn btn-primary" data-testid="vod-manual-submit" disabled={!manualPath}>
          <Play className="w-3.5 h-3.5" /> Preview
        </button>
      </form>
    </div>
  );
}
