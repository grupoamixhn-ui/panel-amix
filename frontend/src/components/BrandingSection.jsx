import { useEffect, useRef, useState } from "react";
import api from "../api";
import { useBranding } from "../branding";
import { Upload, Trash2, Image as ImageIcon, Palette, RotateCcw, Wand2 } from "lucide-react";

// Color suggestions auto-derived from common logo palettes
const DEFAULT_PRIMARY = "#2563EB";
const DEFAULT_HOVER = "#1D4ED8";
const DEFAULT_SOFT = "#EFF6FF";

// Simple HSL nudge so users only have to pick the primary; we auto-derive
// a slightly darker hover + soft tint from it.
function deriveFromPrimary(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { hover: hex, soft: hex };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dark = (c) => Math.max(0, Math.round(c * 0.78));
  const soft = (c) => Math.min(255, Math.round(c + (255 - c) * 0.92));
  const toHex = (c) => c.toString(16).padStart(2, "0");
  return {
    hover: `#${toHex(dark(r))}${toHex(dark(g))}${toHex(dark(b))}`.toUpperCase(),
    soft: `#${toHex(soft(r))}${toHex(soft(g))}${toHex(soft(b))}`.toUpperCase(),
  };
}

// Extract the dominant brand color from a logo image (data URI or URL).
// Filters out near-white, near-black and low-saturation (grayscale) pixels so
// we end up with the actual brand accent rather than the background.
async function extractDominantColorFromImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        // Downscale for speed; 80x80 ≈ 6400 samples is plenty
        const SIZE = 80;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

        // Quantize into 32-step buckets per channel → 32^3 = 32768 keys
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;                                  // skip transparent
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max < 35 || min > 235) continue;                    // skip near-black / near-white
          if (max - min < 35) continue;                           // skip near-gray
          const key = `${r >> 3}-${g >> 3}-${b >> 3}`;           // 32-step bucket
          const entry = buckets.get(key);
          if (entry) {
            entry.count++;
            entry.r += r; entry.g += g; entry.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }
        if (buckets.size === 0) {
          // All pixels filtered out → fallback to default
          resolve(null);
          return;
        }
        // Pick the most common bucket
        let best = null;
        for (const entry of buckets.values()) {
          if (!best || entry.count > best.count) best = entry;
        }
        const r = Math.round(best.r / best.count);
        const g = Math.round(best.g / best.count);
        const b = Math.round(best.b / best.count);
        const toHex = (c) => c.toString(16).padStart(2, "0");
        resolve(`#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase());
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Failed to load logo image"));
    img.src = src;
  });
}

export default function BrandingSection() {
  const branding = useBranding();
  const [brandName, setBrandName] = useState("");
  const [tagline, setTagline] = useState("");
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [primaryHover, setPrimaryHover] = useState(DEFAULT_HOVER);
  const [primarySoft, setPrimarySoft] = useState(DEFAULT_SOFT);
  const [autoDerive, setAutoDerive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const fileRef = useRef(null);
  const faviconRef = useRef(null);

  useEffect(() => {
    setBrandName(branding.brand_name || "");
    setTagline(branding.tagline || "");
    setPrimary(branding.primary_color || DEFAULT_PRIMARY);
    setPrimaryHover(branding.primary_hover || DEFAULT_HOVER);
    setPrimarySoft(branding.primary_soft || DEFAULT_SOFT);
  }, [branding.brand_name, branding.tagline, branding.primary_color, branding.primary_hover, branding.primary_soft]);

  // When auto-derive is on, recompute hover + soft from primary
  useEffect(() => {
    if (!autoDerive) return;
    const { hover, soft } = deriveFromPrimary(primary);
    setPrimaryHover(hover);
    setPrimarySoft(soft);
  }, [primary, autoDerive]);

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

  const saveColors = async () => {
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("primary_color", primary);
      fd.append("primary_hover", primaryHover);
      fd.append("primary_soft", primarySoft);
      await api.post("/branding", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await branding.reload();
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const pickColorsFromLogo = async () => {
    if (!branding.logo_data_uri) {
      setErr("Upload a logo first.");
      return;
    }
    setErr(""); setBusy(true);
    try {
      const dominant = await extractDominantColorFromImage(branding.logo_data_uri);
      if (!dominant) {
        setErr("Could not detect a brand color in this logo (too light, dark or grayscale).");
        return;
      }
      setPrimary(dominant);
      setAutoDerive(true); // hover + soft will recompute via the useEffect
    } catch (e) {
      setErr(e?.message || "Failed to read the logo image.");
    } finally {
      setBusy(false);
    }
  };

  const resetColors = async () => {
    if (!window.confirm("Reset brand colors to the default blue?")) return;
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("primary_color", "");
      fd.append("primary_hover", "");
      fd.append("primary_soft", "");
      await api.post("/branding", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await branding.reload();
      setPrimary(DEFAULT_PRIMARY);
      setPrimaryHover(DEFAULT_HOVER);
      setPrimarySoft(DEFAULT_SOFT);
      setAutoDerive(true);
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

  const uploadFavicon = async (file) => {
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("favicon", file);
      await api.post("/branding", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await branding.reload();
      setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const removeFavicon = async () => {
    if (!window.confirm("Remove the custom favicon? The logo (or default) will be used instead.")) return;
    setErr(""); setBusy(true);
    try {
      await api.delete("/branding/favicon");
      await branding.reload();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const onPickFavicon = (e) => {
    const f = e.target.files?.[0];
    if (f) uploadFavicon(f);
    e.target.value = "";
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

          {/* Favicon (browser tab icon) */}
          <div className="mt-5 pt-5 border-t border-[var(--border)]">
            <div className="text-xs font-medium text-[var(--text-2)] mb-2">Favicon (browser tab icon)</div>
            <div className="flex items-center gap-3" data-testid="branding-favicon-row">
              <div className="w-12 h-12 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-center overflow-hidden shrink-0" data-testid="branding-favicon-preview">
                {branding.favicon_data_uri ? (
                  <img src={branding.favicon_data_uri} alt="favicon" className="max-w-full max-h-full object-contain" />
                ) : branding.logo_data_uri ? (
                  <img src={branding.logo_data_uri} alt="logo-fallback" className="max-w-full max-h-full object-contain opacity-60" />
                ) : (
                  <ImageIcon className="w-5 h-5 opacity-40" />
                )}
              </div>
              <input
                ref={faviconRef}
                type="file"
                accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,image/webp,image/jpeg,.ico"
                onChange={onPickFavicon}
                className="hidden"
                data-testid="branding-favicon-input"
              />
              <button
                type="button"
                onClick={() => faviconRef.current?.click()}
                disabled={busy}
                className="btn btn-primary"
                data-testid="branding-favicon-upload-button"
              >
                <Upload className="w-3.5 h-3.5" /> {branding.favicon_data_uri ? "Replace favicon" : "Upload favicon"}
              </button>
              {branding.favicon_data_uri && (
                <button
                  type="button"
                  onClick={removeFavicon}
                  disabled={busy}
                  className="btn btn-ghost text-[var(--error)] hover:border-[var(--error)]"
                  data-testid="branding-favicon-remove-button"
                  title="Remove favicon"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-2 leading-relaxed">
              ICO / PNG / SVG — up to 300 KB. If empty, the logo is used as favicon.
              <br />Tip: 32×32 or 64×64 square PNG/SVG looks best on browser tabs.
            </p>
          </div>
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

      {/* Brand colors — advanced */}
      <div className="mt-6 pt-6 border-t border-[var(--border)]" data-testid="branding-colors">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: primarySoft }}>
              <Palette className="w-4 h-4" style={{ color: primary }} />
            </div>
            <div>
              <div className="font-semibold text-sm">Brand colors <span className="text-[var(--muted)] font-normal text-[11px] uppercase tracking-wider ml-1">advanced</span></div>
              <div className="text-xs text-[var(--muted)]">Match the panel accent to the colors in your logo. Applied instantly.</div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-2)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoDerive}
              onChange={(e) => setAutoDerive(e.target.checked)}
              data-testid="branding-color-auto"
            />
            Auto-derive hover & soft
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {/* Primary */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="label mb-2">Primary</div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value.toUpperCase())}
                className="w-10 h-10 rounded-md border border-[var(--border)] cursor-pointer p-0"
                data-testid="branding-primary-color"
              />
              <input
                type="text"
                value={primary}
                onChange={(e) => setPrimary(e.target.value.toUpperCase())}
                placeholder="#2563EB"
                className="flex-1 px-2 py-1.5 text-xs mono uppercase"
                maxLength={9}
              />
            </div>
          </div>
          {/* Hover */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="label mb-2 flex items-center justify-between">
              <span>Hover</span>
              {autoDerive && <span className="text-[9px] text-[var(--muted)] normal-case">auto</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryHover}
                onChange={(e) => setPrimaryHover(e.target.value.toUpperCase())}
                disabled={autoDerive}
                className="w-10 h-10 rounded-md border border-[var(--border)] cursor-pointer p-0 disabled:opacity-50"
                data-testid="branding-primary-hover"
              />
              <input
                type="text"
                value={primaryHover}
                onChange={(e) => setPrimaryHover(e.target.value.toUpperCase())}
                disabled={autoDerive}
                placeholder="#1D4ED8"
                className="flex-1 px-2 py-1.5 text-xs mono uppercase disabled:opacity-50"
                maxLength={9}
              />
            </div>
          </div>
          {/* Soft */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="label mb-2 flex items-center justify-between">
              <span>Soft tint</span>
              {autoDerive && <span className="text-[9px] text-[var(--muted)] normal-case">auto</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primarySoft}
                onChange={(e) => setPrimarySoft(e.target.value.toUpperCase())}
                disabled={autoDerive}
                className="w-10 h-10 rounded-md border border-[var(--border)] cursor-pointer p-0 disabled:opacity-50"
                data-testid="branding-primary-soft"
              />
              <input
                type="text"
                value={primarySoft}
                onChange={(e) => setPrimarySoft(e.target.value.toUpperCase())}
                disabled={autoDerive}
                placeholder="#EFF6FF"
                className="flex-1 px-2 py-1.5 text-xs mono uppercase disabled:opacity-50"
                maxLength={9}
              />
            </div>
          </div>
        </div>

        {/* Live preview swatch */}
        <div className="rounded-xl p-4 mb-4" style={{ background: primarySoft, border: `1px solid ${primary}33` }} data-testid="branding-color-preview">
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: primary, opacity: 0.7 }}>Preview</div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm"
              style={{ background: primary }}
              onMouseEnter={(e) => { e.currentTarget.style.background = primaryHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = primary; }}
            >
              Primary button
            </button>
            <span className="text-xs font-semibold" style={{ color: primary }}>Highlighted text</span>
            <span className="text-[10px] mono px-2 py-1 rounded-md" style={{ background: primarySoft, color: primary, border: `1px solid ${primary}44` }}>● live</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={pickColorsFromLogo}
            disabled={busy || !branding.logo_data_uri}
            className="btn btn-ghost border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary-soft)]"
            data-testid="branding-pick-from-logo-button"
            title={branding.logo_data_uri ? "Auto-pick the dominant color from your uploaded logo" : "Upload a logo first"}
          >
            <Wand2 className="w-3.5 h-3.5" /> Use logo colors
          </button>
          <button
            type="button"
            onClick={saveColors}
            disabled={busy}
            className="btn btn-primary"
            data-testid="branding-save-colors-button"
          >
            {busy ? "Saving…" : "Save colors"}
          </button>
          <button
            type="button"
            onClick={resetColors}
            disabled={busy}
            className="btn btn-ghost"
            data-testid="branding-reset-colors-button"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to default
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)] mt-3 leading-relaxed">
          <strong>Use logo colors</strong> scans your uploaded logo and picks its dominant color automatically. You can still tweak it afterwards — Hover &amp; Soft are derived from Primary.
        </p>
      </div>
    </div>
  );
}
