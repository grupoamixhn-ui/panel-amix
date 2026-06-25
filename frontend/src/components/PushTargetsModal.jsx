import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { X, Plus, Trash2, Send, Youtube, Facebook, Music2, Instagram, RadioTower, Twitch, CheckCircle2 } from "lucide-react";

const TEMPLATES = [
  {
    id: "youtube",
    label: "YouTube",
    icon: Youtube,
    color: "text-red-600",
    server: "rtmp://a.rtmp.youtube.com/live2",
    placeholder: "your-youtube-stream-key",
    help: "Studio → Go Live → Stream key.",
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: Facebook,
    color: "text-blue-600",
    server: "rtmps://live-api-s.facebook.com:443/rtmp",
    placeholder: "FB-XXXXXXXXXX-X-XX",
    help: "Live Producer → Use stream key.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: Music2,
    color: "text-fuchsia-600",
    server: "rtmp://push.tiktok.com/live",
    placeholder: "your-tiktok-stream-key",
    help: "TikTok Live Studio → server URL & key.",
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: Instagram,
    color: "text-pink-600",
    server: "rtmps://live-upload.instagram.com:443/rtmp",
    placeholder: "your-instagram-stream-key",
    help: "Use a 3rd party tool (Instagram restricts mobile-only Live).",
  },
  {
    id: "twitch",
    label: "Twitch",
    icon: Twitch,
    color: "text-purple-600",
    server: "rtmp://live.twitch.tv/app",
    placeholder: "live_XXXXXXX_XXXXXXXX",
    help: "Twitch Dashboard → Settings → Stream key.",
  },
  {
    id: "custom",
    label: "Custom RTMP",
    icon: RadioTower,
    color: "text-slate-600",
    server: "",
    placeholder: "rtmp://your-server/app/key",
    help: "Paste the full destination RTMP URL.",
  },
];

export default function PushTargetsModal({ streamName, onClose }) {
  const [pushes, setPushes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [activeTpl, setActiveTpl] = useState("youtube");
  const [streamKey, setStreamKey] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const tpl = useMemo(() => TEMPLATES.find((t) => t.id === activeTpl) || TEMPLATES[0], [activeTpl]);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get(`/streams/${encodeURIComponent(streamName)}/pushes`);
      setPushes(r.data || []);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [streamName]);

  const finalUrl = useMemo(() => {
    if (tpl.id === "custom") return customUrl.trim();
    if (!streamKey.trim()) return "";
    return `${tpl.server}/${streamKey.trim()}`;
  }, [tpl, streamKey, customUrl]);

  const addPush = async () => {
    if (!finalUrl) return;
    setSaving(true); setErr("");
    try {
      await api.post(`/streams/${encodeURIComponent(streamName)}/pushes`, { url: finalUrl, label: tpl.label });
      setStreamKey(""); setCustomUrl("");
      await load();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setSaving(false); }
  };

  const removePush = async (url) => {
    if (!confirm(`Remove push to ${url}?`)) return;
    setSaving(true); setErr("");
    try {
      await api.delete(`/streams/${encodeURIComponent(streamName)}/pushes`, { params: { url } });
      await load();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4" data-testid="push-modal">
      <div className="w-full max-w-2xl bg-[var(--surface)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--border)] relative max-h-[90vh] flex flex-col">
        <button onClick={onClose} className="absolute top-5 right-5 text-[var(--muted)] hover:text-[var(--text)]" data-testid="push-close">
          <X className="w-4 h-4" />
        </button>

        <div className="px-7 pt-7 pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 mb-1">
            <Send className="w-4 h-4 text-[var(--primary)]" />
            <div className="label">Push targets · {streamName}</div>
          </div>
          <h3 className="text-xl font-semibold tracking-tight">Broadcast to social networks</h3>
          <p className="text-xs text-[var(--muted)] mt-1">
            Flussonic will simultaneously push this live stream (re-encoded as RTMP/RTMPS) to every destination configured here.
          </p>
        </div>

        <div className="px-7 py-5 space-y-5 overflow-y-auto">
          {/* Current pushes */}
          <section>
            <div className="label mb-2">Active destinations ({pushes.length})</div>
            {loading ? (
              <div className="text-xs text-[var(--muted)] py-3">Loading…</div>
            ) : pushes.length === 0 ? (
              <div className="text-xs text-[var(--muted)] px-3 py-4 rounded-lg border border-dashed border-[var(--border)] text-center">No push targets configured yet.</div>
            ) : (
              <ul className="space-y-1.5" data-testid="push-list">
                {pushes.map((p) => {
                  const t = TEMPLATES.find((x) => x.label === p.label) || TEMPLATES.find((x) => x.id === "custom");
                  const Ic = t.icon;
                  return (
                    <li key={p.url} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
                      <Ic className={`w-4 h-4 flex-shrink-0 ${t.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold flex items-center gap-2">
                          {p.label}
                          {p.active && (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] uppercase tracking-wider flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" /> live
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] mono text-[var(--muted)] truncate" title={p.url}>{p.url}</div>
                      </div>
                      <button
                        onClick={() => removePush(p.url)}
                        disabled={saving}
                        className="btn-icon hover:text-[var(--error)]"
                        title="Remove"
                        data-testid={`push-remove-${t.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Add new push */}
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="label mb-3">Add a destination</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
              {TEMPLATES.map((t) => {
                const Ic = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTpl(t.id)}
                    data-testid={`push-tpl-${t.id}`}
                    className={`flex flex-col items-center gap-1 px-2 py-3 rounded-lg border transition-all ${
                      activeTpl === t.id
                        ? "border-[var(--primary)] bg-[var(--primary-soft)] ring-1 ring-[var(--primary)]/30"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <Ic className={`w-5 h-5 ${t.color}`} />
                    <span className="text-[10px] font-semibold">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {tpl.id !== "custom" ? (
              <>
                <div className="mb-3">
                  <label className="text-[11px] font-medium text-[var(--text-2)] block mb-1">Server URL <span className="text-[var(--muted)]">· auto-filled</span></label>
                  <input value={tpl.server} disabled className="w-full px-3 py-2 text-[11px] mono bg-[var(--surface)] opacity-70" />
                </div>
                <div className="mb-3">
                  <label className="text-[11px] font-medium text-[var(--text-2)] block mb-1">Stream key</label>
                  <input
                    data-testid="push-stream-key"
                    value={streamKey}
                    onChange={(e) => setStreamKey(e.target.value)}
                    placeholder={tpl.placeholder}
                    className="w-full px-3 py-2 text-[11px] mono"
                  />
                </div>
              </>
            ) : (
              <div className="mb-3">
                <label className="text-[11px] font-medium text-[var(--text-2)] block mb-1">Full RTMP URL</label>
                <input
                  data-testid="push-custom-url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder={tpl.placeholder}
                  className="w-full px-3 py-2 text-[11px] mono"
                />
              </div>
            )}

            <p className="text-[10px] text-[var(--muted)] mb-3">{tpl.help}</p>

            {finalUrl && (
              <div className="mb-3 px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[10px] mono text-[var(--text-2)] truncate">
                → {finalUrl}
              </div>
            )}

            <button
              data-testid="push-add-btn"
              onClick={addPush}
              disabled={saving || !finalUrl}
              className="btn btn-primary"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? "Adding…" : "Add destination"}
            </button>
          </section>

          {err && (
            <div className="px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>
          )}
        </div>
      </div>
    </div>
  );
}
