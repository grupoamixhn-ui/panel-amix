import { useEffect, useMemo, useState } from "react";
import api from "../api";
import { Radio, CheckCircle2, XCircle, Loader2, Terminal, Copy, RefreshCw, PlayCircle, AlertTriangle } from "lucide-react";

const Row = ({ label, ok, hint }) => (
  <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)]" data-testid={`nginx-rtmp-check-${label.toLowerCase().replace(/\s+/g, "-")}`}>
    <div className="text-xs">
      <div className="font-medium">{label}</div>
      {hint && <div className="text-[11px] text-[var(--muted)] mt-0.5">{hint}</div>}
    </div>
    {ok
      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
      : <XCircle className="w-4 h-4 text-red-500" />}
  </div>
);

const CopyRow = ({ label, value, testId }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch (_e) { /* ignore */ }
  };
  return (
    <div>
      <div className="text-[11px] text-[var(--muted)] mb-1">{label}</div>
      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-md px-3 py-2">
        <span className="mono text-xs truncate flex-1" data-testid={`${testId}-value`}>{value}</span>
        <button type="button" onClick={copy} className="btn-ghost p-1" data-testid={`${testId}-copy`} title="Copy">
          <Copy className="w-3.5 h-3.5" />
        </button>
        {copied && <span className="text-[10px] text-emerald-600">Copied</span>}
      </div>
    </div>
  );
};

export default function NginxRtmpSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");
  const [port, setPort] = useState(1935);
  const [rtmpApp, setRtmpApp] = useState("live");
  const [streamKey, setStreamKey] = useState("mystream");
  const [urls, setUrls] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        api.get("/nginx-rtmp/status"),
        api.post("/nginx-rtmp/urls", { port, app: rtmpApp, stream_key: streamKey }),
      ]);
      setStatus(s.data);
      setUrls(u.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to load nginx-rtmp status");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Refresh URLs when the fields change (debounced-ish)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const u = await api.post("/nginx-rtmp/urls", { port, app: rtmpApp, stream_key: streamKey });
        setUrls(u.data);
      } catch (_e) { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [port, rtmpApp, streamKey]);

  const install = async () => {
    setInstalling(true); setErr(""); setLog("");
    try {
      const { data } = await api.post("/nginx-rtmp/install", { port: Number(port), app: rtmpApp });
      if (!data.ok) { setErr(data.detail || "Install failed to start"); setInstalling(false); return; }
      // Poll log + status
      const poll = setInterval(async () => {
        try {
          const [s, l] = await Promise.all([api.get("/nginx-rtmp/status"), api.get("/nginx-rtmp/log?lines=200")]);
          setStatus(s.data);
          setLog(l.data.log || "");
          if (!s.data.running && s.data.exit_code !== null) {
            clearInterval(poll);
            setInstalling(false);
            if (s.data.exit_code !== 0) setErr(`Install exited with code ${s.data.exit_code}`);
            await load();
          }
        } catch (_e) { /* ignore transient poll errors */ }
      }, 1500);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Install failed");
      setInstalling(false);
    }
  };

  const ready = useMemo(() => status?.nginx_installed && status?.rtmp_module && status?.config_present && status?.rtmp_listening, [status]);

  return (
    <div className="space-y-6" data-testid="nginx-rtmp-section">
      <div className="cell p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
            <Radio className="w-4.5 h-4.5 text-[var(--primary)]" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm">Encoder receiver (nginx-rtmp)</div>
            <div className="text-xs text-[var(--muted)]">
              Turn this VPS into an RTMP ingest point for OBS, vMix, XSplit and other encoders. Flussonic pulls from it via the <span className="mono">Nginx</span> source type in the wizard.
            </div>
          </div>
          <button onClick={load} className="btn btn-secondary text-xs" data-testid="nginx-rtmp-refresh" disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Refresh
          </button>
        </div>

        {err && (
          <div className="mb-4 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
          <Row label="nginx installed" ok={!!status?.nginx_installed} hint={status?.nginx_installed ? "binary detected" : "package missing"} />
          <Row label="rtmp module" ok={!!status?.rtmp_module} hint={status?.rtmp_module ? "compiled in / loaded" : "libnginx-mod-rtmp missing"} />
          <Row label="amixpanel config" ok={!!status?.config_present} hint={status?.config_present ? "rtmp block present" : "not configured yet"} />
          <Row label="listening on tcp/1935" ok={!!status?.rtmp_listening} hint={status?.rtmp_listening ? "receiving connections" : "port closed"} />
        </div>

        {!ready && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <div className="text-sm font-medium mb-2">One-click install</div>
            <div className="text-xs text-[var(--muted)] mb-3">
              Installs <span className="mono">nginx + rtmp module</span>, writes the RTMP + HLS config, opens tcp/1935 on the firewall, and restarts nginx. Idempotent — safe to re-run.
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <div className="text-[11px] text-[var(--muted)] mb-1">RTMP port</div>
                <input value={port} onChange={(e) => setPort(e.target.value)} className="input w-24 text-sm" data-testid="nginx-rtmp-port" />
              </div>
              <div>
                <div className="text-[11px] text-[var(--muted)] mb-1">RTMP app name</div>
                <input value={rtmpApp} onChange={(e) => setRtmpApp(e.target.value)} className="input w-32 text-sm" data-testid="nginx-rtmp-app" />
              </div>
              <button onClick={install} className="btn btn-primary text-sm" disabled={installing} data-testid="nginx-rtmp-install">
                {installing ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Installing…</> : <><PlayCircle className="w-4 h-4 mr-1.5" /> Install nginx-rtmp</>}
              </button>
            </div>
          </div>
        )}

        {(installing || log) && (
          <div className="mt-4">
            <div className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" /> Install log</div>
            <pre className="mono text-[11px] bg-black text-emerald-200 rounded-md p-3 max-h-60 overflow-auto whitespace-pre-wrap" data-testid="nginx-rtmp-log">{log || "Waiting for output…"}</pre>
          </div>
        )}
      </div>

      {ready && urls && (
        <div className="cell p-6" data-testid="nginx-rtmp-urls">
          <div className="font-semibold text-sm mb-1">Encoder connection URLs</div>
          <div className="text-xs text-[var(--muted)] mb-4">Paste these in OBS / vMix / any RTMP encoder. Then in the amixpanel wizard, create a stream with source type <span className="mono">Nginx</span> pointing at <span className="mono">127.0.0.1</span> and the same key.</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Stream key (any word — OBS uses this)</div>
              <input value={streamKey} onChange={(e) => setStreamKey(e.target.value.replace(/[^\w-]/g, ""))} className="input text-sm" data-testid="nginx-rtmp-key" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted)] mb-1">Public IP (auto-detected)</div>
              <div className="mono text-xs px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--border)]">{urls.public_ip}</div>
            </div>
          </div>

          <div className="space-y-3">
            <CopyRow label="OBS / vMix — Server URL" value={urls.obs_url} testId="nginx-rtmp-obs" />
            <CopyRow label="OBS / vMix — Stream Key" value={urls.stream_key} testId="nginx-rtmp-obskey" />
            <CopyRow label="HLS output (playable from any browser)" value={urls.hls_url} testId="nginx-rtmp-hls" />
            <CopyRow label="Flussonic — paste this in the Nginx source card" value={urls.flussonic_pull_url} testId="nginx-rtmp-flu" />
          </div>
        </div>
      )}
    </div>
  );
}
