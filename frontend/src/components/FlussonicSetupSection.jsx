import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Play, RefreshCw, Server, Terminal, XCircle } from "lucide-react";
import api from "../api";

/**
 * "Install Flussonic" + License Key card.
 *
 * - Detects whether Flussonic is already running on the host.
 * - If not: shows an "Install Flussonic" button that triggers the official
 *   installer via the panel's sudoers helper. Streams live log output.
 * - License: lets the admin paste their license key. Stored in our DB and
 *   pushed to Flussonic via /streamer/api/v3/config (hot reload).
 */
export default function FlussonicSetupSection() {
  const [detect, setDetect] = useState(null);
  const [installState, setInstallState] = useState(null);
  const [license, setLicense] = useState(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [installing, setInstalling] = useState(false);
  const [savingLicense, setSavingLicense] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [installLicenseKey, setInstallLicenseKey] = useState("");
  const pollTimer = useRef(null);
  const logRef = useRef(null);

  const refresh = useCallback(async () => {
    const [d, s, l] = await Promise.all([
      api.get("/flussonic/detect").catch(() => ({ data: null })),
      api.get("/flussonic/install/status").catch(() => ({ data: null })),
      api.get("/flussonic/license").catch(() => ({ data: null })),
    ]);
    setDetect(d.data);
    setInstallState(s.data);
    setLicense(l.data);
    return s.data;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live polling while installer is running
  useEffect(() => {
    if (!installState?.running) {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
      return;
    }
    pollTimer.current = setInterval(() => {
      refresh().then(() => {
        if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      });
    }, 2500);
    return () => clearInterval(pollTimer.current);
  }, [installState?.running, refresh]);

  const startInstall = async () => {
    if (!window.confirm(
      "This will download and run the official Flussonic installer on this server. " +
      "It requires sudoers configuration (done by install.sh). Continue?"
    )) return;
    setInstalling(true);
    try {
      await api.post("/flussonic/install", { license_key: installLicenseKey });
      await refresh();
    } catch (e) {
      alert(`Install failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setInstalling(false);
    }
  };

  const saveLicense = async () => {
    if (!licenseKey || licenseKey.length < 8) {
      setSaveResult({ ok: false, error: "License key looks too short" });
      return;
    }
    setSavingLicense(true);
    setSaveResult(null);
    try {
      const r = await api.put("/flussonic/license", { license_key: licenseKey });
      setSaveResult({
        ok: true,
        pushed: r.data?.pushed_to_flussonic,
        push_error: r.data?.push_error,
      });
      setLicenseKey("");
      await refresh();
    } catch (e) {
      setSaveResult({ ok: false, error: e?.response?.data?.detail || e.message });
    } finally {
      setSavingLicense(false);
    }
  };

  const running = installState?.running;
  const installed = detect?.installed || detect?.running;
  const exitCode = installState?.exit_code;
  const installFinished = !running && exitCode !== null && exitCode !== undefined;

  return (
    <div className="space-y-6" data-testid="flussonic-setup-section">
      {/* ---------- Install Flussonic ---------- */}
      <div className="cell p-5" data-testid="install-flussonic-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-600" /> Flussonic Media Server
            </div>
            <div className="text-[13px] text-[var(--muted)] mt-1">
              Install the official Flussonic Media Server on this host. The panel will
              auto-configure the connection after a successful install.
            </div>
          </div>
          <DetectBadge detect={detect} />
        </div>

        {!installed && !running && (
          <div className="space-y-3">
            <div>
              <label className="label">License key (optional — can be added later)</label>
              <input
                type="text"
                value={installLicenseKey}
                onChange={(e) => setInstallLicenseKey(e.target.value.trim())}
                placeholder="lic_xxxxxxxxxxxxxxxxxxxx"
                className="input mono w-full"
                data-testid="install-license-input"
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={startInstall}
              disabled={installing}
              data-testid="install-flussonic-btn"
            >
              {installing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Install Flussonic
            </button>
            <div className="text-[11px] text-[var(--muted)]">
              Runs <code className="mono">sudo flussonic-admin-install-flussonic</code> which executes the
              official installer from <span className="mono">https://flussonic.com/install.sh</span>.
            </div>
          </div>
        )}

        {(running || installFinished) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5" /> Installer log
                {running && <span className="text-xs text-blue-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> running…</span>}
                {!running && installFinished && exitCode === 0 && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> finished OK</span>}
                {!running && installFinished && exitCode !== 0 && <span className="text-xs text-red-600 flex items-center gap-1"><XCircle className="w-3 h-3" /> exit {exitCode}</span>}
              </div>
              <button type="button" className="btn-ghost text-xs" onClick={refresh} data-testid="refresh-install-status">
                <RefreshCw className="w-3 h-3 mr-1" /> refresh
              </button>
            </div>
            <pre
              ref={logRef}
              data-testid="install-log"
              className="mono text-[11px] leading-relaxed bg-[#0F172A] text-[#E2E8F0] rounded-lg p-3 h-72 overflow-y-auto whitespace-pre-wrap"
            >
              {installState?.log || "(waiting for output…)"}
            </pre>
          </div>
        )}

        {installed && !running && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" />
            <div>
              Flussonic detected
              {detect.version && <span className="mono text-xs ml-2">v{detect.version}</span>}
              {detect.url && <span className="mono text-xs ml-2 text-[var(--muted)]">{detect.url}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ---------- License Key ---------- */}
      <div className="cell p-5" data-testid="license-key-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-600" /> License Key
            </div>
            <div className="text-[13px] text-[var(--muted)] mt-1">
              Paste your Flussonic license key. We save it in the panel database and push it to{" "}
              <span className="mono">/streamer/api/v3/config</span> so Flussonic reloads it.
            </div>
          </div>
          <LicenseBadge license={license} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Info label="Edition" value={license?.edition || "—"} />
          <Info label="Valid until" value={license?.valid_until || "—"} />
          <Info label="Current key" value={license?.key_masked || "(not saved)"} mono />
        </div>

        <div className="space-y-2">
          <label className="label">New license key</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.trim())}
              placeholder="lic_xxxxxxxxxxxxxxxxxxxx"
              className="input mono flex-1"
              data-testid="license-key-input"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveLicense}
              disabled={savingLicense || !licenseKey}
              data-testid="save-license-btn"
            >
              {savingLicense ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save & push"}
            </button>
          </div>
          {saveResult?.ok && (
            <div className="text-xs text-emerald-700 flex items-center gap-1.5" data-testid="license-save-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Saved.{" "}
              {saveResult.pushed
                ? "License pushed to Flussonic — config reloaded."
                : `Flussonic not reachable yet${saveResult.push_error ? `: ${saveResult.push_error}` : ""}.`}
            </div>
          )}
          {saveResult?.ok === false && (
            <div className="text-xs text-red-600 flex items-center gap-1.5" data-testid="license-save-error">
              <XCircle className="w-3.5 h-3.5" /> {saveResult.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetectBadge({ detect }) {
  if (!detect) return null;
  if (detect.running) {
    return (
      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 flex items-center gap-1.5">
        <CheckCircle2 className="w-3 h-3" /> Running
      </span>
    );
  }
  if (detect.installed) {
    return (
      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 flex items-center gap-1.5">
        Installed · stopped
      </span>
    );
  }
  return (
    <span className="text-xs text-[var(--muted)] bg-[var(--soft)] border border-[var(--border)] rounded-full px-2.5 py-1">
      Not installed
    </span>
  );
}

function LicenseBadge({ license }) {
  if (!license) return null;
  if (license.reachable && license.valid_until) {
    return (
      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 flex items-center gap-1.5">
        <CheckCircle2 className="w-3 h-3" /> Active
      </span>
    );
  }
  if (license.saved) {
    return (
      <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1">
        Saved
      </span>
    );
  }
  return null;
}

function Info({ label, value, mono = false }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`text-sm text-[var(--text)] truncate ${mono ? "mono" : ""}`} title={value}>{value}</div>
    </div>
  );
}
