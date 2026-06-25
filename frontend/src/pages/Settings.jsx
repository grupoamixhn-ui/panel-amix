import { useEffect, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";
import BrandingSection from "../components/BrandingSection";
import { Zap, Cable, CheckCircle2, XCircle, Loader2, Trash2, Download, Copy, RefreshCw, Package } from "lucide-react";

export default function Settings() {
  const [info, setInfo] = useState(null);
  const [cfg, setCfg] = useState(null);          // current persisted config
  const [form, setForm] = useState({ url: "", user: "", password: "", demo_mode: false, api_path: "" });
  const [touched, setTouched] = useState(false); // whether the user edited the form
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null); // {ok, error?, version?}
  const [savedFlash, setSavedFlash] = useState(false);
  const [release, setRelease] = useState(null);  // {filename, version, size_bytes, sha256, download_url, curl_oneliner}
  const [rebuilding, setRebuilding] = useState(false);
  const [copied, setCopied] = useState("");

  const loadAll = async () => {
    const [i, c] = await Promise.all([
      api.get("/server/info").catch(() => ({ data: null })),
      api.get("/config/flussonic").catch(() => ({ data: null })),
    ]);
    setInfo(i.data);
    if (c.data) {
      setCfg(c.data);
      setForm({
        url: c.data.url || "",
        user: c.data.user || "",
        password: "",
        demo_mode: !!c.data.demo_mode,
        api_path: c.data.api_path || "",
        public_host: c.data.public_host || "",
        srt_port: c.data.srt_port || 9998,
        rtmp_port: c.data.rtmp_port || 1935,
        https: c.data.https !== false,
      });
    }
  };

  useEffect(() => { loadAll().catch((e) => console.error(e)); }, []);

  useEffect(() => {
    api.get("/download/installer/info")
      .then((r) => setRelease(r.data))
      .catch(() => setRelease({ unavailable: true }));
  }, []);

  const rebuildRelease = async () => {
    setRebuilding(true);
    try {
      await api.post("/download/installer/rebuild");
      const r = await api.get("/download/installer/info");
      setRelease(r.data);
    } catch (e) {
      console.error("rebuild failed", e);
      window.alert("Rebuild failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setRebuilding(false);
    }
  };

  const copyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // fallback (older browsers)
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(key); setTimeout(() => setCopied(""), 1500); } catch (e) { /* noop */ }
      document.body.removeChild(ta);
    }
  };

  const fmtBytes = (n) => {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
  };

  const onField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setTouched(true); setTestResult(null); };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data } = await api.post("/config/flussonic/test", {
        url: form.url, user: form.user, password: form.password,
        api_path: form.api_path || null,
      });
      setTestResult(data);
      // If the probe discovered the working path, copy it into the form so Save persists it
      if (data?.ok && data.api_path && data.api_path !== form.api_path) {
        setForm((f) => ({ ...f, api_path: data.api_path }));
        setTouched(true);
      }
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.detail || e.message });
    } finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        url: form.url,
        user: form.user,
        demo_mode: form.demo_mode,
        api_path: form.api_path || null,
        public_host: form.public_host || "",
        srt_port: Number(form.srt_port) || 9998,
        rtmp_port: Number(form.rtmp_port) || 1935,
        https: !!form.https,
        password: form.password === "" && cfg?.has_password ? null : form.password,
      };
      await api.put("/config/flussonic", body);
      setSavedFlash(true);
      setTouched(false);
      setTimeout(() => setSavedFlash(false), 2500);
      await loadAll();
    } catch (e) {
      console.error("save config failed", e);
      alert(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!window.confirm("Clear stored Flussonic config and return to DEMO mode?")) return;
    await api.post("/config/flussonic/clear");
    await loadAll();
    setForm({ url: "", user: "", password: "", demo_mode: false, api_path: "", public_host: "", srt_port: 9998, rtmp_port: 1935, https: true });
    setTestResult(null);
    setTouched(false);
  };

  const isLive = info?.mode === "live";

  return (
    <div data-testid="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Server & integration"
        testId="settings-header"
        right={
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            isLive ? "bg-[var(--live-soft)] border-[#BBF7D0] text-[#15803D]"
                   : "bg-[var(--warn-soft)] border-[#FDE68A] text-[#B45309]"
          }`}>
            <span className={`dot ${isLive ? "dot-live" : "dot-warn"}`} />
            <span className="text-xs font-semibold">{isLive ? "LIVE" : "DEMO"} · {info?.version || "—"}</span>
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-3xl">
        <BrandingSection />

        {/* Connection form */}
        <div className="cell p-6" data-testid="settings-connection">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
              <Cable className="w-4.5 h-4.5 text-[var(--primary)]" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-sm">Connect your Flussonic server</div>
              <div className="text-xs text-[var(--muted)]">
                The backend will proxy admin calls to <span className="mono">/streamer/api/v3</span> on this server.
              </div>
            </div>
          </div>

          <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Server URL</label>
          <input
            data-testid="config-url-input"
            value={form.url}
            onChange={(e) => onField("url", e.target.value)}
            placeholder="http://your-flussonic.example.com or http://1.2.3.4:80"
            className="w-full px-3.5 py-2.5 text-sm mono mb-4"
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Username</label>
              <input
                data-testid="config-user-input"
                value={form.user}
                onChange={(e) => onField("user", e.target.value)}
                placeholder="admin"
                className="w-full px-3.5 py-2.5 text-sm mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">
                Password / API token
                {cfg?.has_password && form.password === "" && (
                  <span className="ml-2 text-[10px] text-[var(--muted)] font-normal">(saved · leave empty to keep)</span>
                )}
              </label>
              <input
                data-testid="config-password-input"
                type="password"
                value={form.password}
                onChange={(e) => onField("password", e.target.value)}
                placeholder={cfg?.has_password ? "•••••••• (stored)" : "password or ADM-xxxxxx"}
                className="w-full px-3.5 py-2.5 text-sm mono"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 mt-5 text-sm cursor-pointer select-none" data-testid="config-demo-toggle">
            <input
              type="checkbox"
              checked={form.demo_mode}
              onChange={(e) => onField("demo_mode", e.target.checked)}
              className="w-4 h-4 accent-[var(--primary)]"
            />
            <span>
              Demo mode (ignore real server and show mock data)
              <span className="block text-xs text-[var(--muted)]">Useful while you set up the server or troubleshoot.</span>
            </span>
          </label>

          <details className="mt-5 group">
            <summary className="text-xs font-medium text-[var(--text-2)] cursor-pointer select-none hover:text-[var(--primary)]">
              Advanced · API base path
            </summary>
            <div className="mt-3">
              <input
                data-testid="config-api-path-input"
                value={form.api_path}
                onChange={(e) => onField("api_path", e.target.value)}
                placeholder="/streamer/api/v3 (leave empty to auto-detect)"
                className="w-full px-3.5 py-2.5 text-sm mono"
              />
              <p className="text-[11px] text-[var(--muted)] mt-1.5 leading-relaxed">
                Leave empty and click <span className="font-semibold">Test connection</span> — the panel will probe
                <span className="mono"> /streamer/api/v3</span>, <span className="mono">/flussonic/api</span>,
                <span className="mono"> /api/v3</span> and <span className="mono">/erlyvideo/api</span>,
                and auto-fill the one that works.
              </p>
            </div>
          </details>

          <details className="mt-3" open>
            <summary className="text-xs font-medium text-[var(--text-2)] cursor-pointer select-none hover:text-[var(--primary)]">
              Public delivery · DNS &amp; ports shown to your viewers
            </summary>
            <div className="mt-3 grid grid-cols-12 gap-3">
              <div className="col-span-8">
                <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Public host (DNS)</label>
                <input
                  data-testid="config-public-host-input"
                  value={form.public_host}
                  onChange={(e) => onField("public_host", e.target.value)}
                  placeholder="streaming.yourdomain.com (defaults to Server URL host)"
                  className="w-full px-3.5 py-2.5 text-sm mono"
                />
              </div>
              <div className="col-span-4">
                <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">HLS over</label>
                <select
                  data-testid="config-https-select"
                  value={form.https ? "https" : "http"}
                  onChange={(e) => onField("https", e.target.value === "https")}
                  className="w-full px-3 py-2.5 text-sm mono"
                >
                  <option value="https">HTTPS</option>
                  <option value="http">HTTP</option>
                </select>
              </div>
              <div className="col-span-6">
                <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">RTMP port</label>
                <input
                  data-testid="config-rtmp-port-input"
                  type="number" min="1" max="65535"
                  value={form.rtmp_port}
                  onChange={(e) => onField("rtmp_port", e.target.value)}
                  placeholder="1935"
                  className="w-full px-3.5 py-2.5 text-sm mono"
                />
              </div>
              <div className="col-span-6">
                <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">SRT port</label>
                <input
                  data-testid="config-srt-port-input"
                  type="number" min="1" max="65535"
                  value={form.srt_port}
                  onChange={(e) => onField("srt_port", e.target.value)}
                  placeholder="9998"
                  className="w-full px-3.5 py-2.5 text-sm mono"
                />
              </div>
              <p className="col-span-12 text-[11px] text-[var(--muted)] leading-relaxed">
                These are used to build the playback / publish URLs shown on each stream
                (<span className="mono">https://HOST/STREAM/index.m3u8</span>,
                <span className="mono"> rtmp://HOST/STREAM</span>,
                <span className="mono"> srt://HOST:PORT?streamid=STREAM</span>).
              </p>
            </div>
          </details>

          {/* Test result */}
          {testResult && (
            <div
              data-testid="config-test-result"
              className={`mt-5 flex items-start gap-3 px-4 py-3 rounded-lg border ${
                testResult.ok
                  ? "bg-[var(--live-soft)] border-[#BBF7D0] text-[#15803D]"
                  : "bg-[var(--error-soft)] border-[#FECACA] text-[var(--error)]"
              }`}
            >
              {testResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
              <div className="text-xs flex-1 min-w-0">
                <div className="font-semibold">
                  {testResult.ok ? "Connection OK" : "Connection failed"}
                </div>
                <div className="mono mt-0.5 break-all">
                  {testResult.ok
                    ? `Flussonic ${testResult.version} · API at ${testResult.api_path || "/streamer/api/v3"}`
                    : testResult.error}
                </div>
                {!testResult.ok && Array.isArray(testResult.tried) && testResult.tried.length > 1 && (
                  <div className="mono mt-1.5 opacity-80 text-[10px]">
                    Tried: {testResult.tried.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              data-testid="config-reset-button"
              onClick={reset}
              className="btn btn-ghost text-[var(--error)] hover:border-[var(--error)]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear & reset
            </button>

            <div className="flex items-center gap-3">
              {savedFlash && <span className="text-xs text-[var(--live)] font-medium" data-testid="config-saved-flash">Saved ✓</span>}
              <button
                type="button"
                data-testid="config-test-button"
                onClick={test}
                disabled={testing || !form.url}
                className="btn btn-ghost disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Test connection
              </button>
              <button
                type="button"
                data-testid="config-save-button"
                onClick={save}
                disabled={saving || (!touched && !savedFlash)}
                className="btn btn-primary disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & apply"}
              </button>
            </div>
          </div>
        </div>

        {/* Self-hosted installer download */}
        {release && !release.unavailable && (
          <div className="cell p-6" data-testid="settings-installer">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--primary-soft)] flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-[var(--primary)]" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Self-hosted installer</div>
                  <div className="text-xs text-[var(--muted)] leading-snug mt-0.5">
                    Download a ready-to-deploy tarball for your own VPS (Ubuntu / Debian / AlmaLinux). The bundled <span className="mono">install.sh</span> sets up Python, Node, MongoDB, nginx and a systemd service.
                  </div>
                </div>
              </div>
              <button
                onClick={rebuildRelease}
                disabled={rebuilding}
                className="btn-icon"
                title="Rebuild from current source (admin only)"
                data-testid="installer-rebuild-btn"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rebuilding ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="label mb-0.5">Version</div>
                <div className="mono text-xs font-semibold" data-testid="installer-version">{release.version}</div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <div className="label mb-0.5">Size</div>
                <div className="mono text-xs font-semibold">{fmtBytes(release.size_bytes)}</div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] col-span-2">
                <div className="label mb-0.5 flex items-center justify-between">
                  <span>SHA-256</span>
                  <button onClick={() => copyText("sha", release.sha256)} className="text-[var(--muted)] hover:text-[var(--text)] p-0.5" title="Copy">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                <div className="mono text-[10px] text-[var(--muted)] truncate">{release.sha256}</div>
              </div>
            </div>

            <a
              href={release.download_url}
              className="btn btn-primary w-full justify-center mb-4"
              download
              data-testid="installer-download-btn"
            >
              <Download className="w-4 h-4" />
              Download {release.filename}
              {copied === "sha" && <span className="ml-2 text-[10px] mono opacity-80">checksum copied</span>}
            </a>

            <div className="rounded-xl border border-[var(--border)] bg-[#0F172A] text-[#E2E8F0] p-4 font-mono text-[11.5px] leading-relaxed relative" data-testid="installer-curl">
              <button
                onClick={() => copyText("curl", release.curl_oneliner)}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"
                title="Copy command"
                data-testid="installer-copy-curl"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">One-liner install on a fresh server</div>
              <div className="whitespace-pre-wrap break-all pr-8">{release.curl_oneliner}</div>
              {copied === "curl" && (
                <div className="absolute bottom-2 right-2 text-[10px] mono text-emerald-400">copied ✓</div>
              )}
            </div>

            <p className="text-[11px] text-[var(--muted)] mt-3 leading-snug">
              Tip: pass <span className="mono">--domain panel.example.com</span> at the end of the install command to enable HTTPS via Let&apos;s Encrypt automatically.
            </p>
          </div>
        )}

        {/* Quick references */}
        <div className="cell p-6" data-testid="settings-help">
          <div className="font-semibold text-sm mb-3">Source URL examples</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {[
              ["RTMP pull", "rtmp://origin.example/live/key"],
              ["RTMP receive", "publish://"],
              ["SRT pull", "srt://origin.example:9000?streamid=name"],
              ["SRT listener", "publish://srt-listener:9000"],
              ["HLS pull", "hls://origin.example/playlist.m3u8"],
              ["UDP / RTP", "udp://239.0.0.10:1234"],
              ["RTSP camera", "rtsp://192.168.1.10:554/live"],
              ["MP4 file", "file:///storage/movies/loop.mp4"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
                <span className="font-medium text-[var(--text-2)]">{k}</span>
                <span className="mono text-[var(--muted)] text-[11px] truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="cell p-6" data-testid="settings-api">
          <div className="font-semibold text-sm mb-3">Supported Flussonic v3 endpoints (proxied)</div>
          <ul className="space-y-1.5 mono text-xs">
            {[
              ["GET", "/streamer/api/v3/server"],
              ["GET", "/streamer/api/v3/streams"],
              ["PUT", "/streamer/api/v3/streams/{name}"],
              ["DELETE", "/streamer/api/v3/streams/{name}"],
              ["POST", "/streamer/api/v3/streams/{name}/restart"],
              ["POST", "/streamer/api/v3/streams/{name}/stop"],
              ["GET", "/streamer/api/v3/sessions"],
            ].map(([m, p]) => (
              <li key={p} className="flex items-center gap-3 py-1.5 border-b border-[var(--border)] last:border-0">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                  m === "GET" ? "bg-blue-50 text-blue-700"
                  : m === "POST" ? "bg-emerald-50 text-emerald-700"
                  : m === "PUT" ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700"
                }`}>{m}</span>
                <span className="text-[var(--text-2)]">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
