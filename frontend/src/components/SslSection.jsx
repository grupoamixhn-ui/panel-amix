import { useEffect, useState } from "react";
import api from "../api";
import { Shield, ShieldCheck, ShieldAlert, UploadCloud, Globe2, RefreshCw, Copy, Check } from "lucide-react";

function fmtDate(s) {
  if (!s) return "—";
  // OpenSSL format: "Jul 18 12:34:56 2026 GMT" — Date() parses it
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}
function daysUntil(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

function CopyChip({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}
      className="text-[10px] mono px-1.5 py-0.5 rounded border border-[var(--border)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1"
      data-testid={`ssl-copy-${label}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export default function SslSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("status");  // status | letsencrypt | manual

  // Let's Encrypt form
  const [leDomain, setLeDomain] = useState("");
  const [leEmail, setLeEmail] = useState("");
  const [leBusy, setLeBusy] = useState(false);
  const [leResult, setLeResult] = useState(null);

  // Manual upload form
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [forFlussonic, setForFlussonic] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.get("/ssl/status");
      setStatus(r.data);
    } catch (e) {
      setStatus({ error: e.response?.data?.detail || e.message });
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const exp = daysUntil(status?.not_after);
  const expColor = exp == null ? "text-[var(--muted)]" : exp < 0 ? "text-[var(--error)]" : exp < 14 ? "text-amber-600" : "text-emerald-600";

  return (
    <section className="card p-6 mb-6" data-testid="ssl-section">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-[var(--primary)] mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">SSL certificate</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">Manage the TLS cert that nginx serves for this panel. You can also share it with Flussonic.</p>
          </div>
        </div>
        <button onClick={refresh} className="btn btn-secondary text-xs" data-testid="ssl-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 mb-5 border-b border-[var(--border)]">
        {[
          ["status", "Status"],
          ["letsencrypt", "Let's Encrypt"],
          ["manual", "Manual upload"],
        ].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            data-testid={`ssl-tab-${k}`}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${tab === k ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "status" && (
        <div className="space-y-3" data-testid="ssl-status-panel">
          {loading ? (
            <div className="text-xs text-[var(--muted)]">Loading…</div>
          ) : !status?.exists ? (
            <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 mt-0.5" />
              <div>
                No SSL certificate found at <span className="mono">{status?.cert_path}</span>.<br />
                The panel may be running on plain HTTP. Use the tabs above to install one.
              </div>
            </div>
          ) : (
            <>
              <div className={`px-4 py-3 rounded-lg border ${status.self_signed ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"} text-sm flex items-start gap-2`}>
                {status.self_signed ? <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5" /> : <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5" />}
                <div>
                  <strong>{status.self_signed ? "Self-signed certificate" : "Trusted certificate"}</strong>{" "}
                  {status.self_signed && <span className="text-[11px] opacity-80">— browsers will show a warning. Use Let's Encrypt for trusted cert.</span>}
                  <div className={`text-[11px] mono mt-1 ${expColor}`} data-testid="ssl-expiry">
                    Expires: {fmtDate(status.not_after)} {exp != null && (<>· <strong>{exp > 0 ? `${exp} days left` : `expired ${-exp} days ago`}</strong></>)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <Field label="Subject" value={status.subject} />
                <Field label="Issuer"  value={status.issuer} />
                <Field label="Valid from" value={fmtDate(status.not_before)} />
                <Field label="Fingerprint (SHA-256)" value={status.fingerprint_sha256} mono />
                <Field label="Cert path" value={status.cert_path} mono />
                <Field label="Key path"  value={status.key_path} mono />
              </div>
            </>
          )}
        </div>
      )}

      {tab === "letsencrypt" && (
        <div className="space-y-3" data-testid="ssl-letsencrypt-panel">
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Requests a real trusted TLS certificate from Let's Encrypt via <span className="mono">certbot --nginx</span>.<br />
            <strong>Pre-requisites:</strong> (1) the domain DNS A record must point to this server's public IP, (2) port 80 must be open, (3) certbot must be installed (the bundled installer installs it).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              data-testid="ssl-le-domain"
              value={leDomain}
              onChange={(e) => setLeDomain(e.target.value.trim())}
              placeholder="panel.example.com"
              className="px-3 py-2 text-sm mono"
            />
            <input
              data-testid="ssl-le-email"
              value={leEmail}
              onChange={(e) => setLeEmail(e.target.value.trim())}
              placeholder="you@example.com (optional, for expiry reminders)"
              className="px-3 py-2 text-sm"
            />
          </div>
          <button
            data-testid="ssl-le-submit"
            disabled={leBusy || !leDomain}
            onClick={async () => {
              setLeBusy(true); setLeResult(null);
              try {
                const r = await api.post("/ssl/letsencrypt", { domain: leDomain, email: leEmail });
                setLeResult({ ok: r.data.ok, message: r.data.message || "Done." });
                if (r.data.ok) refresh();
              } catch (e) {
                setLeResult({ ok: false, message: e.response?.data?.detail || e.message });
              } finally { setLeBusy(false); }
            }}
            className="btn btn-primary"
          >
            <Globe2 className="w-3.5 h-3.5" />
            {leBusy ? "Requesting cert…" : "Get certificate from Let's Encrypt"}
          </button>
          {leResult && (
            <div className={`px-3 py-2 rounded-lg text-xs ${leResult.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)]"}`} data-testid="ssl-le-result">
              <pre className="whitespace-pre-wrap mono text-[11px]">{leResult.message}</pre>
            </div>
          )}
          <details className="text-[11px] text-[var(--muted)]">
            <summary className="cursor-pointer">Manual SSH alternative (if the button fails)</summary>
            <pre className="mono mt-2 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] overflow-x-auto leading-relaxed">{`# On the server, via SSH:
sudo certbot --nginx -d ${leDomain || "panel.example.com"} ${leEmail ? `-m ${leEmail}` : "--register-unsafely-without-email"} --agree-tos --non-interactive

# Verify:
sudo nginx -t && sudo systemctl reload nginx`}</pre>
          </details>
        </div>
      )}

      {tab === "manual" && (
        <div className="space-y-3" data-testid="ssl-manual-panel">
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Paste your existing certificate + private key (PEM format). Use this if you bought a cert,
            use Cloudflare Origin certs, have a wildcard, or generate one yourself with <span className="mono">openssl</span>.
          </p>
          <div>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Certificate (full chain, PEM)</label>
            <textarea
              data-testid="ssl-manual-cert"
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              rows={6}
              placeholder="-----BEGIN CERTIFICATE-----&#10;MIIE…&#10;-----END CERTIFICATE-----"
              className="w-full px-3 py-2 text-[11px] mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Private key (PEM)</label>
            <textarea
              data-testid="ssl-manual-key"
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              rows={6}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIE…&#10;-----END PRIVATE KEY-----"
              className="w-full px-3 py-2 text-[11px] mono"
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="ssl-manual-flussonic">
            <input type="checkbox" checked={forFlussonic} onChange={(e) => setForFlussonic(e.target.checked)} />
            Also copy to <span className="mono">/etc/flussonic/ssl/</span> so Flussonic uses the same certificate
          </label>
          <button
            data-testid="ssl-manual-submit"
            disabled={uploadBusy || !certPem || !keyPem}
            onClick={async () => {
              setUploadBusy(true); setUploadResult(null);
              try {
                const r = await api.post("/ssl/upload", { cert_pem: certPem, key_pem: keyPem, also_for_flussonic: forFlussonic });
                setUploadResult({ ok: r.data.ok, message: r.data.message });
                if (r.data.ok) { setCertPem(""); setKeyPem(""); refresh(); }
              } catch (e) {
                setUploadResult({ ok: false, message: e.response?.data?.detail || e.message });
              } finally { setUploadBusy(false); }
            }}
            className="btn btn-primary"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            {uploadBusy ? "Installing…" : "Install certificate"}
          </button>
          {uploadResult && (
            <div className={`px-3 py-2 rounded-lg text-xs ${uploadResult.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)]"}`} data-testid="ssl-manual-result">
              {uploadResult.message}
            </div>
          )}
          <details className="text-[11px] text-[var(--muted)]">
            <summary className="cursor-pointer">Generate a self-signed cert quickly (via SSH)</summary>
            <pre className="mono mt-2 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] overflow-x-auto leading-relaxed">{`openssl req -x509 -nodes -newkey rsa:2048 \\
  -keyout key.pem -out cert.pem -days 3650 \\
  -subj "/CN=$(hostname)" -addext "subjectAltName=DNS:$(hostname),IP:$(hostname -I | awk '{print $1}')"

# Then paste cert.pem + key.pem above and click Install.`}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2 bg-[var(--surface-2)]">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">{label}</div>
      <div className={`text-[11px] mt-0.5 break-all ${mono ? "mono" : ""}`} data-testid={`ssl-field-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value || "—"} {mono && value && <CopyChip text={value} label={label.toLowerCase().replace(/\s+/g, "-")} />}
      </div>
    </div>
  );
}
