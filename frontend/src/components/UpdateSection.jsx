import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api";
import {
  ArrowUpCircle, Github, Globe, Upload, RefreshCw, AlertTriangle,
  CheckCircle2, History, Loader2, FileArchive,
} from "lucide-react";

const SRC_LABEL = { github: "GitHub release", url: "Custom URL", upload: "Manual upload", none: "Disabled" };

function fmtBytes(n) {
  if (!n) return "0 B";
  const k = 1024;
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${u[i]}`;
}

function fmtDate(iso) {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString();
  } catch { return iso; }
}

export default function UpdateSection() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    source_type: "none",
    github_repo: "",
    github_token: "",
    custom_url: "",
    auto_check_hours: 6,
    auto_check_enabled: true,
  });
  const [tokenTouched, setTokenTouched] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/updates/status");
      setStatus(r.data);
      if (!tokenTouched) {
        setForm({
          source_type: r.data.source_type || "none",
          github_repo: r.data.github_repo || "",
          github_token: "",
          custom_url: r.data.custom_url || "",
          auto_check_hours: r.data.auto_check_hours || 6,
          auto_check_enabled: r.data.auto_check_enabled !== false,
        });
      }
    } catch (e) {
      console.error("updates status load failed", e);
    }
  }, [tokenTouched]);

  useEffect(() => { load(); }, [load]);

  const flash = (kind, text) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg({ kind: "", text: "" }), 6000);
  };

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const payload = { ...form };
      if (!tokenTouched) delete payload.github_token; // keep existing
      await api.put("/updates/config", payload);
      setTokenTouched(false);
      await load();
      flash("ok", "Configuration saved.");
    } catch (e) {
      flash("err", e?.response?.data?.detail || e.message);
    } finally { setSavingCfg(false); }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      await api.post("/updates/check");
      await load();
      flash("ok", "Check completed.");
    } catch (e) {
      flash("err", e?.response?.data?.detail || e.message);
    } finally { setChecking(false); }
  };

  const onUpload = async (f) => {
    if (!f) return;
    if (!f.name.endsWith(".tar.gz")) {
      flash("err", "Only .tar.gz files are accepted.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.post("/updates/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await load();
      flash("ok", `Uploaded ${r.data.filename} (${fmtBytes(r.data.size_bytes)}).`);
    } catch (e) {
      flash("err", e?.response?.data?.detail || e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyUpdate = async (mode, filename, download_url) => {
    const confirmMsg = mode === "full"
      ? `Full reinstall using ${filename || download_url}. This runs install.sh on the VPS. Continue?`
      : `Quick update using ${filename || download_url}. Backend will restart briefly. Continue?`;
    if (!window.confirm(confirmMsg)) return;
    setApplying(true);
    try {
      const r = await api.post("/updates/apply", { mode, filename: filename || "", download_url: download_url || "" });
      await load();
      flash("ok", `${mode === "full" ? "Full reinstall" : "Quick update"} OK · new version: ${r.data.new_version}`);
    } catch (e) {
      flash("err", e?.response?.data?.detail || e.message);
    } finally { setApplying(false); }
  };

  const rollback = async () => {
    if (!window.confirm("Rollback to the previous backup? Current code will be swapped with /opt/amixpanel.bak.")) return;
    setRolling(true);
    try {
      const r = await api.post("/updates/rollback");
      await load();
      flash("ok", `Rollback OK · current version: ${r.data.new_version}`);
    } catch (e) {
      flash("err", e?.response?.data?.detail || e.message);
    } finally { setRolling(false); }
  };

  if (!status) {
    return (
      <div className="cell p-6 flex items-center gap-3 text-sm text-[var(--muted)]" data-testid="update-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading update status…
      </div>
    );
  }

  const updateAvailable = status.update_available;
  const helperReady = status.helper_available;

  return (
    <div className="cell p-6" data-testid="update-section">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <ArrowUpCircle className="w-4.5 h-4.5 text-[var(--primary)]" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Panel updates</div>
          <div className="text-xs text-[var(--muted)]">Auto-pull the latest release and apply it without SSH access.</div>
        </div>
        {updateAvailable && (
          <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md bg-[var(--primary)] text-white" data-testid="update-available-badge">
            Update available
          </span>
        )}
      </div>

      {/* Current state summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="px-4 py-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
          <div className="text-[10px] mono uppercase text-[var(--muted)] mb-1">Current version</div>
          <div className="font-semibold mono text-sm" data-testid="update-current-version">{status.current_version}</div>
        </div>
        <div className="px-4 py-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
          <div className="text-[10px] mono uppercase text-[var(--muted)] mb-1">Latest available</div>
          <div className="font-semibold mono text-sm" data-testid="update-latest-version">
            {status.latest_available_version || <span className="text-[var(--muted)] font-normal">unknown</span>}
          </div>
        </div>
        <div className="px-4 py-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
          <div className="text-[10px] mono uppercase text-[var(--muted)] mb-1">Last check</div>
          <div className="font-semibold text-xs">{fmtDate(status.last_check)}</div>
        </div>
      </div>

      {!helperReady && (
        <div className="mb-5 p-3 rounded-lg bg-[var(--warn-soft)] border border-[#FDE68A] text-[#B45309] text-xs flex items-start gap-2" data-testid="helper-missing-warn">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold mb-0.5">Update helper not installed.</div>
            Re-run <span className="mono">sudo bash install/install.sh</span> on the VPS to provision the helper at <span className="mono">/usr/local/bin/amixpanel-update</span>. Without it, Apply / Rollback are disabled.
          </div>
        </div>
      )}

      {status.last_error && (
        <div className="mb-5 p-3 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">
          <span className="font-semibold">Last error:</span> {status.last_error}
        </div>
      )}

      {/* Source config */}
      <div className="mb-5">
        <div className="label mb-2">Update source</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {[
            { v: "github", lbl: "GitHub", icon: Github },
            { v: "url",    lbl: "Custom URL", icon: Globe },
            { v: "upload", lbl: "Manual upload", icon: Upload },
            { v: "none",   lbl: "Disabled", icon: null },
          ].map(({ v, lbl, icon: Icon }) => (
            <button
              key={v}
              onClick={() => setForm({ ...form, source_type: v })}
              data-testid={`update-source-${v}`}
              className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all flex items-center justify-center gap-2 ${
                form.source_type === v
                  ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                  : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--primary)]"
              }`}
            >
              {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
              {lbl}
            </button>
          ))}
        </div>

        {form.source_type === "github" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Repository (owner/repo)</label>
              <input
                data-testid="update-github-repo"
                value={form.github_repo}
                onChange={(e) => setForm({ ...form, github_repo: e.target.value })}
                placeholder="myorg/amixpanel"
                className="w-full px-3 py-2 text-sm mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">
                Personal access token <span className="text-[var(--muted)] font-normal">(private repos only)</span>
              </label>
              <input
                data-testid="update-github-token"
                type="password"
                value={form.github_token}
                onChange={(e) => { setForm({ ...form, github_token: e.target.value }); setTokenTouched(true); }}
                placeholder={status.github_token ? "•••••••• (saved — leave blank to keep)" : "ghp_…"}
                className="w-full px-3 py-2 text-sm mono"
              />
            </div>
          </div>
        )}

        {form.source_type === "url" && (
          <div>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Tarball URL or /info endpoint</label>
            <input
              data-testid="update-custom-url"
              value={form.custom_url}
              onChange={(e) => setForm({ ...form, custom_url: e.target.value })}
              placeholder="https://my-panel.example.com/api/download/installer/info"
              className="w-full px-3 py-2 text-sm mono"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1.5">
              Tip: point this at another amixpanel’s <span className="mono">/api/download/installer/info</span>
              {" "}to mirror its latest build automatically.
            </p>
          </div>
        )}

        {(form.source_type === "github" || form.source_type === "url") && (
          <div className="flex items-center gap-4 mt-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                data-testid="update-auto-check"
                checked={form.auto_check_enabled}
                onChange={(e) => setForm({ ...form, auto_check_enabled: e.target.checked })}
              />
              Auto-check every
            </label>
            <input
              data-testid="update-interval"
              type="number"
              min="1"
              max="168"
              value={form.auto_check_hours}
              onChange={(e) => setForm({ ...form, auto_check_hours: parseInt(e.target.value || "6", 10) })}
              className="w-20 px-2 py-1.5 text-sm mono"
            />
            <span className="text-xs text-[var(--muted)]">hours</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button onClick={saveCfg} disabled={savingCfg} className="btn btn-primary text-xs py-2" data-testid="update-save-config">
          {savingCfg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save configuration
        </button>
        {(form.source_type === "github" || form.source_type === "url") && (
          <button onClick={checkNow} disabled={checking} className="btn btn-secondary text-xs py-2" data-testid="update-check-now">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} /> Check now
          </button>
        )}
        {updateAvailable && (form.source_type === "github" || form.source_type === "url") && (
          <button
            onClick={() => applyUpdate("quick", "", status.latest_available_url)}
            disabled={applying || !helperReady}
            className="btn btn-primary text-xs py-2"
            data-testid="update-apply-remote-quick"
          >
            {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
            Apply update ({status.latest_available_version})
          </button>
        )}
      </div>

      {/* Manual upload */}
      <div className="mb-5 pt-5 border-t border-[var(--border)]">
        <div className="label mb-2">Upload a tarball manually</div>
        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".tar.gz,application/gzip"
            data-testid="update-file-input"
            onChange={(e) => onUpload(e.target.files?.[0])}
            disabled={uploading}
            className="text-xs"
          />
          {uploading && <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />}
        </div>
      </div>

      {/* Spool: tarballs awaiting apply */}
      {status.spool && status.spool.length > 0 && (
        <div className="mb-5">
          <div className="label mb-2">Pending tarballs ({status.spool.length})</div>
          <div className="space-y-2">
            {status.spool.map((t) => (
              <div key={t.filename} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]" data-testid={`spool-${t.filename}`}>
                <FileArchive className="w-4 h-4 text-[var(--muted)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium mono text-xs truncate">{t.filename}</div>
                  <div className="text-[10px] text-[var(--muted)]">{fmtBytes(t.size_bytes)} · {fmtDate(t.mtime)}</div>
                </div>
                <button
                  onClick={() => applyUpdate("quick", t.filename)}
                  disabled={applying || !helperReady}
                  className="btn btn-primary text-[10px] py-1.5 px-2.5"
                  data-testid={`spool-quick-${t.filename}`}
                  title="Replace backend/+frontend bundle and restart (fastest)"
                >
                  Quick
                </button>
                <button
                  onClick={() => applyUpdate("full", t.filename)}
                  disabled={applying || !helperReady}
                  className="btn btn-secondary text-[10px] py-1.5 px-2.5"
                  data-testid={`spool-full-${t.filename}`}
                  title="Run install.sh again (rebuilds nginx, sudoers, systemd unit)"
                >
                  Full
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rollback */}
      {status.has_backup && (
        <div className="pt-5 border-t border-[var(--border)]">
          <div className="label mb-2">Rollback</div>
          <p className="text-xs text-[var(--muted)] mb-2">
            A backup of the previous installation is available at <span className="mono">/opt/amixpanel.bak</span>.
          </p>
          <button
            onClick={rollback}
            disabled={rolling || !helperReady}
            className="btn btn-secondary text-xs py-2"
            data-testid="update-rollback"
          >
            {rolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
            Restore previous version
          </button>
        </div>
      )}

      {msg.text && (
        <div
          className={`mt-4 px-3 py-2 rounded-lg text-xs flex items-start gap-2 ${
            msg.kind === "ok"
              ? "bg-[var(--live-soft)] border border-[#BBF7D0] text-[#15803D]"
              : "bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)]"
          }`}
          data-testid="update-message"
        >
          {msg.kind === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div className="whitespace-pre-wrap font-mono text-[11px]">{msg.text}</div>
        </div>
      )}
    </div>
  );
}
