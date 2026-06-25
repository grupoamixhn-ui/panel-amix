import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { X, Radio, Tv2, Cast, Camera, Film, Globe, Wifi, Pencil, Trash2, Lock, Eye, EyeOff } from "lucide-react";

const TYPES = [
  { id: "srt-pull",     label: "SRT pull",     desc: "Connect to a remote SRT source",          icon: Cast },
  { id: "srt-listen",   label: "SRT receive",  desc: "Accept push from OBS / encoder",          icon: Wifi },
  { id: "rtmp-pull",    label: "RTMP pull",    desc: "Read from a remote RTMP server",          icon: Radio },
  { id: "rtmp-publish", label: "RTMP receive", desc: "Receive push from OBS / encoder",         icon: Tv2 },
  { id: "hls-pull",     label: "HLS pull",     desc: "Re-stream a .m3u8 playlist",              icon: Globe },
  { id: "udp",          label: "UDP / RTP",    desc: "Multicast / unicast MPEG-TS",             icon: Radio },
  { id: "rtsp",         label: "RTSP camera",  desc: "IP camera or NVR",                        icon: Camera },
  { id: "file",         label: "File loop",    desc: "Loop a local MP4 / TS file",              icon: Film },
  { id: "custom",       label: "Custom URL",   desc: "Paste any URL Flussonic supports",        icon: Pencil },
];

// ---------- URL builders ----------
function build(typeId, f) {
  switch (typeId) {
    case "srt-pull": {
      const q = f.streamid ? `?streamid=${f.streamid}` : "";
      return `srt://${f.host || ""}:${f.port || 9999}${q}`;
    }
    case "srt-listen":
      return `publish://srt-listener:${f.port || 9998}`;
    case "rtmp-pull":
      return `rtmp://${f.host || ""}/${(f.app || "").replace(/^\/+/, "")}${f.key ? `/${f.key}` : ""}`;
    case "rtmp-publish":
      return `publish://`;
    case "hls-pull":
      return f.url || "";
    case "udp":
      return `udp://${f.host || "239.0.0.10"}:${f.port || 1234}`;
    case "rtsp":
      return `rtsp://${f.host || ""}${f.port ? `:${f.port}` : ""}/${(f.path || "").replace(/^\/+/, "")}`;
    case "file":
      return `file://${f.path || ""}`;
    case "custom":
      return f.url || "";
    default:
      return "";
  }
}

// ---------- Type-specific fields ----------
function Fields({ typeId, fields, set }) {
  const i = "w-full px-3 py-2 text-sm mono";
  const small = "w-32 px-3 py-2 text-sm mono";
  switch (typeId) {
    case "srt-pull":
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label l="Host" /><input className={i} value={fields.host || ""} onChange={(e) => set("host", e.target.value)} placeholder="origin.example.com" /></div>
          <div><Label l="Port" /><input className={small} value={fields.port || ""} onChange={(e) => set("port", e.target.value)} placeholder="9999" /></div>
          <div><Label l="Stream ID" /><input className={i} value={fields.streamid || ""} onChange={(e) => set("streamid", e.target.value)} placeholder="optional" /></div>
        </div>
      );
    case "srt-listen":
      return (
        <div>
          <Label l="Listen port" /><input className={small} value={fields.port || ""} onChange={(e) => set("port", e.target.value)} placeholder="9998" />
          <p className="text-[11px] text-[var(--muted)] mt-2">Encoder pushes to <span className="mono">srt://YOUR_HOST:PORT?streamid=publish:STREAM_NAME</span></p>
        </div>
      );
    case "rtmp-pull":
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label l="Host" /><input className={i} value={fields.host || ""} onChange={(e) => set("host", e.target.value)} placeholder="origin.example.com" /></div>
          <div><Label l="App" /><input className={i} value={fields.app || ""} onChange={(e) => set("app", e.target.value)} placeholder="live" /></div>
          <div><Label l="Key (optional)" /><input className={i} value={fields.key || ""} onChange={(e) => set("key", e.target.value)} placeholder="abc123" /></div>
        </div>
      );
    case "rtmp-publish":
      return (
        <div className="px-3 py-2 rounded-lg bg-[var(--primary-soft)] border border-blue-100 text-xs text-[var(--text-2)] leading-relaxed">
          Flussonic will <strong>receive</strong> the RTMP stream pushed by your encoder.<br />
          After saving, point OBS / FFmpeg to:<br />
          <span className="mono">rtmp://YOUR_HOST/STREAM_NAME</span>
        </div>
      );
    case "hls-pull":
      return (
        <div>
          <Label l=".m3u8 URL" />
          <input className={i} value={fields.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://origin.example.com/master.m3u8" />
        </div>
      );
    case "udp":
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label l="Host / multicast IP" /><input className={i} value={fields.host || ""} onChange={(e) => set("host", e.target.value)} placeholder="239.0.0.10" /></div>
          <div><Label l="Port" /><input className={small} value={fields.port || ""} onChange={(e) => set("port", e.target.value)} placeholder="1234" /></div>
        </div>
      );
    case "rtsp":
      return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label l="Host" /><input className={i} value={fields.host || ""} onChange={(e) => set("host", e.target.value)} placeholder="192.168.1.10" /></div>
          <div><Label l="Port" /><input className={small} value={fields.port || ""} onChange={(e) => set("port", e.target.value)} placeholder="554" /></div>
          <div><Label l="Path" /><input className={i} value={fields.path || ""} onChange={(e) => set("path", e.target.value)} placeholder="live/main" /></div>
        </div>
      );
    case "file":
      return (
        <div>
          <Label l="Absolute file path" />
          <input className={i} value={fields.path || ""} onChange={(e) => set("path", e.target.value)} placeholder="/storage/movies/loop.mp4" />
        </div>
      );
    case "custom":
      return (
        <div>
          <Label l="Source URL" />
          <input className={i} value={fields.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="rtsp://… / srt://… / udp://…" />
        </div>
      );
    default:
      return null;
  }
}

function Label({ l }) {
  return <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">{l}</label>;
}

// ---------- Outputs preview ----------
function OutputsPreview({ name }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    if (!name) { setData(null); return; }
    api.get(`/streams/${name}/outputs`).then((r) => { if (active) setData(r.data); }).catch(() => {});
    return () => { active = false; };
  }, [name]);
  if (!name) {
    return <div className="text-[11px] text-[var(--muted)] mt-2">Enter a name above to preview the playback URLs that Flussonic will publish.</div>;
  }
  if (!data) return <div className="text-[11px] text-[var(--muted)]">Loading…</div>;
  return (
    <div className="space-y-1.5">
      {data.outputs.slice(0, 4).map((o) => (
        <div key={o.label} className="flex items-center gap-2 text-[11px]">
          <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] mono text-[10px] font-semibold text-[var(--text-2)] uppercase">{o.protocol}</span>
          <span className="mono text-[var(--muted)] truncate" title={o.url}>{o.url}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Main wizard component ----------
export default function StreamWizard({ initial, onClose, onSaved, onDeleted }) {
  const editing = !!initial?.name;
  const [name, setName] = useState(initial?.name || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [typeId, setTypeId] = useState(initial ? "custom" : "srt-pull");
  const [fields, setFields] = useState(initial ? { url: initial?.inputs?.[0]?.url || "" } : { port: 9999 });
  const [publishPassword, setPublishPassword] = useState(initial?.publish_password || "");
  const [maxBitrateKbps, setMaxBitrateKbps] = useState(initial?.max_bitrate_kbps || 0);
  const [sourceTimeout, setSourceTimeout] = useState(initial?.source_timeout || 60);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const url = useMemo(() => build(typeId, fields), [typeId, fields]);
  const setF = (k, v) => setFields((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (!url) { setErr("Source URL is empty"); setBusy(false); return; }
      const payload = {
        url, title,
        publish_password: publishPassword || "",
        max_bitrate_kbps: Number(maxBitrateKbps) || 0,
        source_timeout: Number(sourceTimeout) || 0,
      };
      if (editing) {
        await api.put(`/streams/${name}`, payload);
      } else {
        await api.post("/streams", { name, ...payload });
      }
      onSaved(name);
    } catch (e2) {
      const m = e2.response?.data?.detail;
      setErr(typeof m === "string" ? m : "Save failed");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete stream "${name}"? This cannot be undone.`)) return;
    setDeleting(true); setErr("");
    try {
      await api.delete(`/streams/${name}`);
      onDeleted?.(name);
    } catch (e2) {
      const m = e2.response?.data?.detail;
      setErr(typeof m === "string" ? m : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="stream-form-modal">
      <form
        onSubmit={submit}
        className="w-full max-w-3xl bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--border)] relative max-h-[90vh] flex flex-col"
      >
        <button type="button" onClick={onClose} className="absolute top-5 right-5 text-[var(--muted)] hover:text-[var(--text)] z-10" data-testid="stream-form-close">
          <X className="w-4 h-4" />
        </button>

        <div className="px-7 pt-7 pb-4 border-b border-[var(--border)]">
          <div className="label mb-1">{editing ? "Modify stream" : "New stream"}</div>
          <h3 className="text-xl font-semibold tracking-tight">{editing ? name : "Configure ingest"}</h3>
        </div>

        <div className="px-7 py-5 overflow-y-auto">
          {/* Name + Title row */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div>
              <Label l="Stream name (used in URLs)" />
              <input
                data-testid="stream-form-name"
                value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                required disabled={editing} placeholder="my_stream"
                className="w-full px-3 py-2 text-sm mono disabled:opacity-60"
              />
            </div>
            <div>
              <Label l="Title (optional)" />
              <input
                data-testid="stream-form-title"
                value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Friendly name"
                className="w-full px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Input type selector */}
          <Label l="Input type" />
          <div className="grid grid-cols-3 gap-2 mb-5" data-testid="stream-form-types">
            {TYPES.map(({ id, label, desc, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-testid={`stream-form-type-${id}`}
                onClick={() => { setTypeId(id); setFields({}); }}
                className={`text-left px-3 py-2.5 rounded-lg border transition-all ${
                  typeId === id
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] ring-1 ring-[var(--primary)]/30"
                    : "border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--surface)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-3.5 h-3.5 ${typeId === id ? "text-[var(--primary)]" : "text-[var(--muted)]"}`} />
                  <span className="text-xs font-semibold">{label}</span>
                </div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5 leading-snug">{desc}</div>
              </button>
            ))}
          </div>

          {/* Type-specific fields */}
          <div className="cell-flat rounded-lg p-4 mb-5 bg-[var(--surface-2)] border border-[var(--border)]">
            <Fields typeId={typeId} fields={fields} set={setF} />

            <div className="grad-line my-4" />

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[11px] text-[var(--muted)]">Resulting source URL</div>
              <code className="text-[11px] mono px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] truncate max-w-full" data-testid="stream-form-resolved-url">
                {url || "—"}
              </code>
            </div>
          </div>

          {/* Publish password (RTMP / SRT) */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 mb-5">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-3.5 h-3.5 text-[var(--muted)]" />
              <div className="text-xs font-semibold">Publish password <span className="text-[var(--muted)] font-normal">· optional</span></div>
            </div>
            <p className="text-[11px] text-[var(--muted)] mb-2 leading-snug">
              When set, Flussonic only accepts RTMP / SRT push from encoders that include this password.
              OBS / encoder URL becomes <span className="mono">rtmp://host/{name || "STREAM"}?password=•••</span>.
            </p>
            <div className="relative">
              <input
                data-testid="stream-form-publish-password"
                type={showPw ? "text" : "password"}
                value={publishPassword}
                onChange={(e) => setPublishPassword(e.target.value)}
                placeholder="Leave empty to disable"
                className="w-full px-3 py-2 text-sm mono pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] p-1"
                data-testid="stream-form-pw-toggle"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Limits & timeouts */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 mb-5" data-testid="stream-form-limits">
            <div className="text-xs font-semibold mb-3">Limits &amp; timeouts <span className="text-[var(--muted)] font-normal">· optional</span></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label l="Max input bitrate (kbps)" />
                <input
                  data-testid="stream-form-max-bitrate"
                  type="number" min="0" step="100"
                  value={maxBitrateKbps}
                  onChange={(e) => setMaxBitrateKbps(e.target.value)}
                  placeholder="0 = unlimited"
                  className="w-full px-3 py-2 text-sm mono"
                />
                <p className="text-[10px] text-[var(--muted)] mt-1 leading-snug">
                  Cap the maximum incoming bitrate. Flussonic will drop frames above this. <strong>0 = no cap</strong>.
                </p>
              </div>
              <div>
                <Label l="Source timeout (s)" />
                <input
                  data-testid="stream-form-source-timeout"
                  type="number" min="0" step="1"
                  value={sourceTimeout}
                  onChange={(e) => setSourceTimeout(e.target.value)}
                  placeholder="60"
                  className="w-full px-3 py-2 text-sm mono"
                />
                <p className="text-[10px] text-[var(--muted)] mt-1 leading-snug">
                  Wait this many seconds before declaring the source dead. Recommended <strong>60</strong>.
                </p>
              </div>
            </div>
            <details className="mt-3 group">
              <summary className="text-[11px] text-[var(--muted)] cursor-pointer hover:text-[var(--text-2)] select-none">
                Server-wide limits (max sessions, client timeout) →
              </summary>
              <div className="mt-2 text-[11px] text-[var(--muted)] leading-snug">
                <code className="mono text-[10px]">max_sessions</code> and <code className="mono text-[10px]">client_timeout</code> are <strong>global</strong> settings in Flussonic and can&apos;t be edited per-stream via the API. Edit them in <code className="mono text-[10px]">/etc/flussonic/flussonic.conf</code> under <code className="mono text-[10px]">sessions {"{ max_sessions 400; client_timeout 60; }"}</code> then restart Flussonic.
              </div>
            </details>
          </div>

          {/* Outputs preview */}
          <details open className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <summary className="text-xs font-semibold cursor-pointer select-none">Output URLs · what your viewers will use</summary>
            <div className="mt-2"><OutputsPreview name={name} /></div>
          </details>

          {err && <div className="mt-4 px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>}
        </div>

        <div className="px-7 py-4 border-t border-[var(--border)] flex gap-3 justify-between items-center bg-[var(--surface-2)] rounded-b-2xl">
          <div>
            {editing && (
              <button
                type="button"
                onClick={remove}
                disabled={deleting || busy}
                className="btn btn-ghost text-[var(--error)] hover:border-[var(--error)] disabled:opacity-50"
                data-testid="stream-form-delete"
              >
                <Trash2 className="w-3.5 h-3.5" /> {deleting ? "Deleting…" : "Delete stream"}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn btn-ghost" data-testid="stream-form-cancel">Cancel</button>
            <button type="submit" disabled={busy || deleting} className="btn btn-primary" data-testid="stream-form-submit">
              {busy ? "Saving…" : editing ? "Save changes" : "Create stream"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
