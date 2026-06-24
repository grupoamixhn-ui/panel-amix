import { useEffect, useRef, useState } from "react";
import api from "../api";
import { useBranding } from "../branding";
import { Upload, Trash2, Image as ImageIcon } from "lucide-react";

export default function BrandingSection() {
  const branding = useBranding();
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setBrandName(branding.brand_name || "");
    setTagline(branding.tagline || "");
  }, [branding.brand_name, branding.tagline]);

  const upload = async (file) => {
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      await api.post("/branding", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await branding.reload();
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const saveText = async () => {
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("brand_name", brandName);
      fd.append("tagline", tagline);
      await api.post("/branding", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await branding.reload();
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const removeLogo = async () => {
    if (!window.confirm("Remove logo and go back to default?")) return;
    setErr(""); setBusy(true);
    try {
      await api.delete("/branding/logo");
      await branding.reload();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = "";
  };

  return (
    <div className="cell p-6" data-testid="settings-branding">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
          <ImageIcon className="w-4.5 h-4.5 text-[var(--primary)]" />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Branding</div>
          <div className="text-xs text-[var(--muted)]">Your logo and brand name shown on login and the sidebar.</div>
        </div>
        {savedFlash && <span className="text-xs text-[var(--live)] font-medium">Saved ✓</span>}
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Logo preview + upload */}
        <div className="col-span-12 md:col-span-5">
          <div className="text-xs font-medium text-[var(--text-2)] mb-2">Logo</div>
          <div className="aspect-[5/2] rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-center p-4" data-testid="branding-logo-preview">
            {branding.logo_data_uri ? (
              <img src={branding.logo_data_uri} alt="logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="text-[11px] text-[var(--muted)] text-center">
                <ImageIcon className="w-6 h-6 mx-auto mb-1 opacity-40" />
                No logo yet
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
            onChange={onPick}
            className="hidden"
            data-testid="branding-file-input"
          />
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn btn-primary flex-1 justify-center"
              data-testid="branding-upload-button"
            >
              <Upload className="w-3.5 h-3.5" /> {branding.logo_data_uri ? "Replace logo" : "Upload logo"}
            </button>
            {branding.logo_data_uri && (
              <button
                type="button"
                onClick={removeLogo}
                disabled={busy}
                className="btn btn-ghost text-[var(--error)] hover:border-[var(--error)]"
                data-testid="branding-remove-button"
                title="Remove logo"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-2 leading-relaxed">
            PNG / JPG / SVG / WebP — up to 1 MB. Transparent PNG/SVG looks best.
          </p>
        </div>

        {/* Brand name + tagline */}
        <div className="col-span-12 md:col-span-7 space-y-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Brand name</label>
            <input
              data-testid="branding-name-input"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Flussonic"
              maxLength={40}
              className="w-full px-3.5 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Tagline (small text under brand name)</label>
            <input
              data-testid="branding-tagline-input"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="NOC Console"
              maxLength={60}
              className="w-full px-3.5 py-2.5 text-sm"
            />
          </div>

          {err && <div className="px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">{err}</div>}

          <button
            type="button"
            onClick={saveText}
            disabled={busy}
            className="btn btn-primary"
            data-testid="branding-save-text-button"
          >
            {busy ? "Saving…" : "Save brand name & tagline"}
          </button>
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            Brand name and tagline are only shown when no logo is uploaded. Once a logo is set, it replaces the text.
          </p>
        </div>
      </div>
    </div>
  );
}
