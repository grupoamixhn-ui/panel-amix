import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";

const EMPTY = {
  logo_data_uri: "", brand_name: "", tagline: "",
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

export function BrandingProvider({ children }) {
  const [brand, setBrand] = useState(EMPTY);

  const reload = useCallback(async () => {
    try {
      const r = await api.get("/branding");
      const next = { ...EMPTY, ...(r.data || {}) };
      setBrand(next);
      applyBrandColors(next);
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
