import { useEffect, useState } from "react";
import { Check, Code2, Copy, ExternalLink, KeyRound, Loader2, RefreshCw, X } from "lucide-react";
import api from "../api";

/**
 * "Get embed code" modal.
 *
 * Generates (or fetches) an opaque embed token for the stream and shows the
 * `<iframe>` snippet the operator pastes on a client's website. The iframe
 * points at `/api/embed/{token}` — a public HTML page that plays the stream
 * via hls.js. The actual m3u8 URL is proxied through the panel so viewers
 * never see the underlying Flussonic host or stream name.
 */
export default function EmbedCodeModal({ streamName, onClose }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(720);
  const [height, setHeight] = useState(405);

  const fetchToken = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/streams/${encodeURIComponent(streamName)}/embed`);
      setToken(data.token);
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchToken(); /* eslint-disable-next-line */ }, [streamName]);

  const rotate = async () => {
    if (!window.confirm(
      "Rotate the embed token?\n\nAll iframes already published on client websites will STOP working immediately — you'll need to update them with the new snippet."
    )) return;
    setRotating(true);
    try {
      const { data } = await api.post(`/streams/${encodeURIComponent(streamName)}/embed/rotate`);
      setToken(data.token);
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setRotating(false);
    }
  };

  const embedUrl = token
    ? `${window.location.origin}/api/embed/${token}`
    : "";
  const snippet = token
    ? `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`
    : "";

  const copy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--surface)] rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="embed-modal">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
              <Code2 className="w-4 h-4 text-blue-600" /> Embed code — {streamName}
            </div>
            <div className="text-[12px] text-[var(--muted)] mt-0.5">
              Paste this iframe on a webpage. Viewers won&apos;t see the underlying stream URL.
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1" data-testid="embed-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted)] py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating embed token…
            </div>
          ) : (
            <>
              {/* Live preview */}
              <div className="rounded-lg overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }} data-testid="embed-preview">
                {embedUrl && (
                  <iframe
                    src={embedUrl}
                    title="preview"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    style={{ display: "block", width: "100%", height: "100%" }}
                  />
                )}
              </div>

              {/* Size inputs */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="label text-[10px]">Width (px)</label>
                  <input
                    type="number" min="200" step="10"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value) || 720)}
                    className="w-full px-3 py-1.5 text-sm mono border border-[var(--border)] rounded-md bg-[var(--surface)]"
                    data-testid="embed-width"
                  />
                </div>
                <div className="flex-1">
                  <label className="label text-[10px]">Height (px)</label>
                  <input
                    type="number" min="100" step="10"
                    value={height}
                    onChange={(e) => setHeight(Number(e.target.value) || 405)}
                    className="w-full px-3 py-1.5 text-sm mono border border-[var(--border)] rounded-md bg-[var(--surface)]"
                    data-testid="embed-height"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setWidth(720); setHeight(405); }}
                  className="btn-ghost text-xs mt-4"
                >
                  16:9 default
                </button>
              </div>

              {/* Snippet */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label">HTML snippet</label>
                  <button type="button" onClick={copy} className="btn-ghost text-xs" data-testid="embed-copy">
                    {copied ? <><Check className="w-3 h-3 mr-1 text-emerald-600" /> Copied</> : <><Copy className="w-3 h-3 mr-1" /> Copy</>}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={snippet}
                  onFocus={(e) => e.target.select()}
                  className="w-full px-3 py-2 text-xs mono border border-[var(--border)] rounded-md bg-[var(--surface-2)] font-mono resize-none"
                  rows={4}
                  data-testid="embed-snippet"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[var(--border)]">
                <a
                  href={embedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary text-xs"
                  data-testid="embed-open-external"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open in new tab
                </a>
                <button
                  type="button"
                  onClick={rotate}
                  disabled={rotating}
                  className="btn btn-warning text-xs"
                  data-testid="embed-rotate"
                >
                  {rotating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  Rotate token
                </button>
                <div className="text-[11px] text-[var(--muted)] flex items-center gap-1 ml-auto">
                  <KeyRound className="w-3 h-3" /> <span className="mono">{token.slice(0, 6)}…{token.slice(-4)}</span>
                </div>
              </div>

              <div className="text-[11px] text-[var(--muted)] leading-relaxed bg-[var(--surface-2)] rounded-md p-3 border border-[var(--border)]">
                <div className="font-semibold mb-1 text-[var(--text)]">Protection notes</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>The real HLS URL is <strong>not</strong> exposed in the iframe DOM.</li>
                  <li>Segments are proxied through the panel — pirates can&apos;t scrape the source.</li>
                  <li>Use <em>Rotate token</em> if a client cancels service — old iframes stop instantly.</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
