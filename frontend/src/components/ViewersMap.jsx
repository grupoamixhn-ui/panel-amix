import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { Globe2, Users } from "lucide-react";

/**
 * Choropleth world map showing where the active viewers of a stream are
 * connecting from. Receives the raw `sessions` array (each item has a
 * `country` 2-letter code provided by Flussonic) and groups by country.
 *
 * Uses the public world-atlas 110m topojson from unpkg — no extra build
 * step required. The map is purely informative; it doesn't fetch tiles
 * so it works offline / behind a strict CSP that only allows unpkg.
 */
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Convert 3-letter ISO codes (used by world-atlas) → common 2-letter codes
// Flussonic reports the latter. We don't ship the full table here; just the
// minimum we need for the centroid pop-up. The choropleth uses ISO_A3 directly.
const ISO3_TO_NAME = {
  USA: "United States", MEX: "Mexico", HND: "Honduras", GTM: "Guatemala",
  SLV: "El Salvador", NIC: "Nicaragua", CRI: "Costa Rica", PAN: "Panama",
  COL: "Colombia", VEN: "Venezuela", ECU: "Ecuador", PER: "Peru",
  BRA: "Brazil", ARG: "Argentina", CHL: "Chile", URY: "Uruguay",
  ESP: "Spain", FRA: "France", DEU: "Germany", ITA: "Italy", GBR: "United Kingdom",
  CAN: "Canada", DOM: "Dominican Rep.", CUB: "Cuba", PRI: "Puerto Rico",
};

// 2→3 letter mapping (only the codes we expect Flussonic + IP geoloc to emit).
// Anything not in this table still works for the count but won't paint a country.
const ISO2_TO_ISO3 = {
  US: "USA", MX: "MEX", HN: "HND", GT: "GTM", SV: "SLV", NI: "NIC",
  CR: "CRI", PA: "PAN", CO: "COL", VE: "VEN", EC: "ECU", PE: "PER",
  BR: "BRA", AR: "ARG", CL: "CHL", UY: "URY",
  ES: "ESP", FR: "FRA", DE: "DEU", IT: "ITA", GB: "GBR", UK: "GBR",
  CA: "CAN", DO: "DOM", CU: "CUB", PR: "PRI",
  // World extras users may have
  CN: "CHN", IN: "IND", JP: "JPN", KR: "KOR", AU: "AUS", NZ: "NZL",
  RU: "RUS", UA: "UKR", PL: "POL", NL: "NLD", BE: "BEL", PT: "PRT",
  ZA: "ZAF", NG: "NGA", EG: "EGY", MA: "MAR", TR: "TUR", SA: "SAU",
};

// The world-atlas 110m TopoJSON uses **UN M49 numeric codes** as geo.id, NOT
// ISO_A3 strings. Map ISO-3 → M49 for the codes we care about so the
// choropleth lookup works. Source: ISO 3166-1.
const ISO3_TO_M49 = {
  USA: "840", MEX: "484", HND: "340", GTM: "320", SLV: "222", NIC: "558",
  CRI: "188", PAN: "591", COL: "170", VEN: "862", ECU: "218", PER: "604",
  BRA: "076", ARG: "032", CHL: "152", URY: "858",
  ESP: "724", FRA: "250", DEU: "276", ITA: "380", GBR: "826",
  CAN: "124", DOM: "214", CUB: "192", PRI: "630",
  CHN: "156", IND: "356", JPN: "392", KOR: "410", AUS: "036", NZL: "554",
  RUS: "643", UKR: "804", POL: "616", NLD: "528", BEL: "056", PRT: "620",
  ZAF: "710", NGA: "566", EGY: "818", MAR: "504", TUR: "792", SAU: "682",
};

function countryName(iso3) {
  return ISO3_TO_NAME[iso3] || iso3;
}

function colorFor(count, max) {
  if (!count) return "#E5E7EB";
  if (max <= 1) return "#22C55E";
  // Linear scale clamped to [0.25, 1] so even 1-viewer countries are clearly colored.
  const t = Math.max(0.25, Math.min(1, count / max));
  // green (low) → red (high)
  const interp = (a, b) => Math.round(a + (b - a) * t);
  const r = interp(34, 220);
  const g = interp(197, 38);
  const b = interp(94, 38);
  return `rgb(${r},${g},${b})`;
}

export default function ViewersMap({ sessions = [] }) {
  const [hover, setHover] = useState(null); // {iso3, name, count}

  // Group sessions by M49 numeric code (used as geo.id by world-atlas TopoJSON)
  const { byM49, total, topList, max } = useMemo(() => {
    const counts = new Map();
    const labels = new Map();   // M49 → display name
    let totalN = 0;
    for (const s of sessions) {
      totalN += 1;
      const code2 = (s.country || "").toUpperCase().trim();
      const iso3 = ISO2_TO_ISO3[code2] || "";
      const m49 = iso3 ? ISO3_TO_M49[iso3] : "";
      const key = m49 || `??${code2 || "?"}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!labels.has(key)) labels.set(key, iso3 ? countryName(iso3) : code2 || "Unknown");
    }
    const list = Array.from(counts.entries())
      .map(([m, n]) => ({ m49: m, count: n, name: labels.get(m) }))
      .sort((a, b) => b.count - a.count);
    const maxN = list.length ? list[0].count : 0;
    return { byM49: counts, total: totalN, topList: list.slice(0, 6), max: maxN };
  }, [sessions]);

  if (!sessions.length) {
    return (
      <div className="cell p-5" data-testid="viewers-map-empty">
        <div className="label flex items-center gap-2 mb-2"><Globe2 className="w-3.5 h-3.5" /> Geographic distribution</div>
        <div className="text-xs text-[var(--muted)] text-center py-8">No active viewers right now.</div>
      </div>
    );
  }

  return (
    <div className="cell p-5" data-testid="viewers-map">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="label flex items-center gap-2">
          <Globe2 className="w-3.5 h-3.5" /> Geographic distribution
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {total} viewers · {byM49.size} countries</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px]">low</span>
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "#86EFAC" }} />
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "#FBBF24" }} />
            <span className="inline-block w-3 h-2 rounded-sm" style={{ background: "#DC2626" }} />
            <span className="text-[10px]">high</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
        <div className="relative bg-[#F8FAFC] rounded-lg overflow-hidden">
          <ComposableMap
            projectionConfig={{ scale: 140 }}
            width={800}
            height={420}
            style={{ width: "100%", height: "auto" }}
            data-testid="viewers-map-svg"
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const m49 = String(geo.id || "").padStart(3, "0");
                  const count = byM49.get(m49) || 0;
                  const name = geo.properties?.name || m49;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={colorFor(count, max)}
                      stroke="#FFF"
                      strokeWidth={0.4}
                      onMouseEnter={() => setHover({ m49, name, count })}
                      onMouseLeave={() => setHover(null)}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", filter: "brightness(0.85)" },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>
          {hover && (
            <div className="absolute top-2 left-2 bg-white/95 backdrop-blur rounded-md px-2.5 py-1.5 shadow text-xs border border-[var(--border)] pointer-events-none" data-testid="viewers-map-tooltip">
              <div className="font-semibold text-[var(--text)]">{hover.name}</div>
              <div className="mono text-[11px] text-[var(--muted)]">
                {hover.count > 0 ? `${hover.count} viewer${hover.count > 1 ? "s" : ""}` : "no viewers"}
              </div>
            </div>
          )}
        </div>

        <div data-testid="viewers-map-top">
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-2">Top countries</div>
          <ul className="space-y-1">
            {topList.map((c) => (
              <li key={c.iso3} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate" title={c.name}>{c.name}</span>
                <span className="mono font-semibold text-[var(--text)]">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
