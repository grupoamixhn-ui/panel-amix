import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Download, Loader2, Upload, Users } from "lucide-react";
import api from "../api";

/**
 * Panel backup / restore card.
 *
 * - Export: downloads users + config + branding + SSL settings as a single
 *   JSON file the admin can keep as disaster recovery.
 * - Import: lets the admin upload a previously-exported JSON to restore the
 *   panel state. The currently-logged-in admin is always preserved.
 */
export default function BackupSection() {
  const [info, setInfo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [merge, setMerge] = useState(false);
  const fileRef = useRef(null);

  const refresh = async () => {
    try {
      const { data } = await api.get("/backup/info");
      setInfo(data);
    } catch {
      setInfo(null);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get("/backup/export", { responseType: "blob" });
      // Pull filename from the server's Content-Disposition when present
      const cd = res.headers?.["content-disposition"] || "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] ||
        `flussonic-admin-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!window.confirm(
      merge
        ? `Restore from "${file.name}" (MERGE mode)?\n\nExisting documents will be upserted. Your current admin account is preserved.`
        : `Restore from "${file.name}" (WIPE mode)?\n\nThis erases users and config collections, then restores from the backup. Your current admin account is preserved.`
    )) {
      event.target.value = "";
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post(`/backup/import?merge=${merge}`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult({ ok: true, ...data });
      await refresh();
    } catch (e) {
      setImportResult({ ok: false, error: e?.response?.data?.detail || e.message });
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-6" data-testid="backup-section">
      <div className="cell p-5" data-testid="backup-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-base font-semibold text-[var(--text)] flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600" /> Panel backup
            </div>
            <div className="text-[13px] text-[var(--muted)] mt-1 leading-snug">
              Exports every user account (admins, resellers, clients), branding,
              theme colors, SSL config and the Flussonic connection settings as
              a single JSON file. Streams themselves live on Flussonic and are
              not part of this backup.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Stat icon={Users} label="Users" value={info?.counts?.users ?? "—"} testId="backup-users-count" />
          <Stat icon={Database} label="Config docs" value={info?.counts?.config ?? "—"} testId="backup-config-count" />
          <Stat icon={CheckCircle2} label="Format" value={info?.version ? `v${info.version}` : "—"} />
          <Stat icon={Download} label="Action" value="ready" />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={exporting}
            data-testid="backup-export-btn"
          >
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Download backup
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            data-testid="backup-import-btn"
          >
            {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Restore from file…
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            className="hidden"
            data-testid="backup-file-input"
          />

          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={merge}
              onChange={(e) => setMerge(e.target.checked)}
              className="rounded"
              data-testid="backup-merge-toggle"
            />
            Merge mode (don&apos;t wipe existing records)
          </label>
        </div>

        {importResult?.ok && (
          <div className="mt-4 flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" data-testid="backup-import-success">
            <CheckCircle2 className="w-4 h-4 mt-0.5" />
            <div>
              Restore complete ({importResult.merge ? "merge mode" : "wipe mode"}).{" "}
              {Object.entries(importResult.restored || {}).map(([k, v]) => `${k}=${v}`).join(", ")}.
              <div className="text-[11px] text-emerald-900/70 mt-1">
                You may need to log out and log back in if your admin profile was part of the backup.
              </div>
            </div>
          </div>
        )}
        {importResult?.ok === false && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="backup-import-error">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div>Restore failed: {importResult.error}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, testId }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-base mono font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}
