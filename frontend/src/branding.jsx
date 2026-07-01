import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";

const EMPTY = {
  logo_data_uri: "", favicon_data_uri: "", brand_name: "", tagline: "",
  primary_color: "", primary_hover: "", primary_soft: "",
};

const BrandingContext = createContext({ ...EMPTY, reload: () => {} });

// Apply (or revert) the custom brand colors as CSS variables on :root so the
// entire UI re-themes itself without rebuilding the stylesheet.
function applyBrandColors({ primary_color, primary_hover, primary_soft }) {
  const root = document.documentElement;
  if (primary_color) root.style.setProperty("--primary", primary_color);
  else root.style.removeProperty("--primary");
  if (primary_hover) root.style.setProperty("--primary-hover", primary_hover);
  else root.style.removeProperty("--primary-hover");
  if (primary_soft) root.style.setProperty("--primary-soft", primary_soft);
  else root.style.removeProperty("--primary-soft");
}

// Update the browser-tab favicon + document title from the uploaded brand
// assets, so the deployed panel can be re-skinned without rebuilding the app.
function applyBrandTab({ logo_data_uri, favicon_data_uri, brand_name, tagline }) {
  const name = (brand_name || "").trim() || "amixpanel";
  document.title = tagline ? `${name} · ${tagline}` : name;

  // Prefer a dedicated favicon upload; fall back to the logo.
  const iconUri = favicon_data_uri || logo_data_uri;
  if (!iconUri) return;
  // Remove any pre-existing icon links so the new one wins
  document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
    .forEach((el) => el.parentNode && el.parentNode.removeChild(el));
  const link = document.createElement("link");
  link.rel = "icon";
  if (iconUri.startsWith("data:image/svg")) link.type = "image/svg+xml";
  else if (iconUri.includes("image/x-icon") || iconUri.includes("vnd.microsoft.icon")) link.type = "image/x-icon";
  else link.type = "image/png";
  link.href = iconUri;
  document.head.appendChild(link);
}

export function BrandingProvider({ children }) {
  const [brand, setBrand] = useState(EMPTY);

  const reload = useCallback(async () => {
    try {
      const r = await api.get("/branding");
      const next = { ...EMPTY, ...(r.data || {}) };
      setBrand(next);
      applyBrandColors(next);
      applyBrandTab(next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <BrandingContext.Provider value={{ ...brand, reload }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
