import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";

const BrandingContext = createContext({ logo_data_uri: "", brand_name: "", tagline: "", reload: () => {} });

export function BrandingProvider({ children }) {
  const [brand, setBrand] = useState({ logo_data_uri: "", brand_name: "", tagline: "" });

  const reload = useCallback(async () => {
    try {
      const r = await api.get("/branding");
      setBrand(r.data || { logo_data_uri: "", brand_name: "", tagline: "" });
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
