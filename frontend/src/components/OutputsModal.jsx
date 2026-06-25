import { useEffect, useMemo, useState } from "react";
import api from "../api";
import HlsPlayer from "./HlsPlayer";
import { Copy, Check, X } from "lucide-react";

const PROTO_BADGE = {
  hls:   "bg-blue-50 text-blue-700 border-blue-200",
  dash:  "bg-purple-50 text-purple-700 border-purple-200",
  rtmp:  "bg-amber-50 text-amber-700 border-amber-200",
  srt:   "bg-rose-50 text-rose-700 border-rose-200",
  rtsp:  "bg-cyan-50 text-cyan-700 border-cyan-200",
};

function Url({ item }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(item.url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
      <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider ${PROTO_BADGE[item.protocol] || "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)]"}`}>
        {item.protocol}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-[var(--text-2)] truncate">{item.label}</div>
        <div className="mono text-[11px] text-[var(--muted)] truncate" title={item.url}>{item.url}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        className={`btn-icon ${copied ? "text-[var(--live)] border-[var(--live)]" : ""}`}
        title="Copy URL"
        data-testid={`copy-${item.protocol}-${item.label}`}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export default function OutputsModal({ streamName, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get(`/streams/${streamName}/outputs`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [streamName]);

  const hlsUrl = useMemo(() => {
    if (!data?.outputs) return "";
    const hls = data.outputs.find((o) => o.protocol === "hls" && o.url.endsWith(".m3u8") && !o.url.includes("_ll"));
    return hls?.url || "";
  }, [data]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="outputs-modal">
      <div className="w-full max-w-2xl bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--border)] relative max-h-[90vh] flex flex-col">
        <button onClick={onClose} className="absolute top-5 right-5 text-[var(--muted)] hover:text-[var(--text)]" data-testid="outputs-close">
          <X className="w-4 h-4" />
        </button>

        <div className="px-7 pt-7 pb-4 border-b border-[var(--border)]">
          <div className="label mb-1">Playback &amp; publish URLs</div>
          <h3 className="text-xl font-semibold tracking-tight">{streamName}</h3>
          {data?.host && (
            <div className="text-xs text-[var(--muted)] mt-1">Public host: <span className="mono text-[var(--text-2)]">{data.host}</span></div>
          )}
        </div>

        <div className="px-7 py-5 overflow-y-auto space-y-5">
          {err && <div className="px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>}

          {hlsUrl && <HlsPlayer url={hlsUrl} />}

          {data && (
            <>
              <section>
                <div className="label mb-3">Output · viewers connect here</div>
                <div className="space-y-2">
                  {data.outputs.map((o) => <Url key={o.label} item={o} />)}
                </div>
              </section>

              {data.publish?.length > 0 && (
                <section>
                  <div className="label mb-3">Publish · encoders / OBS push here</div>
                  <div className="space-y-2">
                    {data.publish.map((o) => <Url key={o.label} item={o} />)}
                  </div>

                  {/* OBS-friendly split (Server + Stream Key) for RTMP and SRT */}
                  {data.publish.filter((p) => p.server && p.stream_key).map((p) => (
                    <div key={`split-${p.protocol}`} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" data-testid={`${p.protocol}-split`}>
                      <Url item={{ protocol: p.protocol, label: `${p.protocol.toUpperCase()} · Server`, url: p.server }} />
                      <Url item={{ protocol: p.protocol, label: `${p.protocol.toUpperCase()} · Stream ${p.protocol === "srt" ? "ID" : "Key"}`, url: p.stream_key }} />
                    </div>
                  ))}

                  {data.publish_password && (
                    <div className="mt-3 px-3 py-2 rounded-lg bg-[var(--primary-soft)] border border-blue-100 text-[11px] text-[var(--text-2)] leading-relaxed flex items-start gap-2" data-testid="publish-password-info">
                      <span className="font-bold mono text-[var(--primary)]">🔒</span>
                      <div>
                        This stream is <strong>password protected for RTMP only</strong>. RTMP encoders must include{" "}
                        <span className="mono">?password={data.publish_password}</span> in the URL (or as part of the OBS stream key).{" "}
                        <span className="text-[var(--muted)]">SRT publish does not carry a password — use the URL as shown.</span>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-[var(--muted)] mt-3 leading-relaxed">
                    For RTMP push from OBS: use the <span className="mono">rtmp://</span> URL as <strong>Server</strong> and the stream name as <strong>Stream Key</strong>.
                  </p>
                </section>
              )}
            </>
          )}
        </div>

        <div className="px-7 py-4 border-t border-[var(--border)] flex justify-end bg-[var(--surface-2)] rounded-b-2xl">
          <button onClick={onClose} className="btn btn-primary" data-testid="outputs-done">Done</button>
        </div>
      </div>
    </div>
  );
}
