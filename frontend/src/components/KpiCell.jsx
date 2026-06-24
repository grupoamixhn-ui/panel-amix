import { fmtNumber } from "../api";

export default function KpiCell({ label, value, suffix, accent, hint, testId }) {
  return (
    <div className="cell p-5 flex flex-col gap-2" data-testid={testId}>
      <div className="label">{label}</div>
      <div className={`mono text-3xl font-semibold tracking-tight ${accent || "text-white"}`}>
        {typeof value === "number" ? fmtNumber(value) : value}
        {suffix && <span className="text-base text-[var(--muted)] ml-1">{suffix}</span>}
      </div>
      {hint && <div className="text-xs text-[var(--muted)] mono">{hint}</div>}
    </div>
  );
}
