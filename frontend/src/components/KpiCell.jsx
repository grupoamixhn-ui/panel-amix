import { fmtNumber } from "../api";

export default function KpiCell({ label, value, suffix, accent, hint, icon: Icon, trend, testId }) {
  return (
    <div className="cell p-5 flex flex-col gap-2 hover:shadow-[var(--shadow-md)] transition-shadow" data-testid={testId}>
      <div className="flex items-center justify-between">
        <div className="label">{label}</div>
        {Icon && (
          <div className="w-7 h-7 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-[var(--muted)]">
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
      <div className={`mono text-3xl font-semibold tracking-tight ${accent || "text-[var(--text)]"}`}>
        {typeof value === "number" ? fmtNumber(value) : value}
        {suffix && <span className="text-base text-[var(--muted)] ml-1.5 font-normal">{suffix}</span>}
      </div>
      <div className="flex items-center gap-2">
        {trend && (
          <span className={`text-[10px] mono uppercase font-semibold ${trend.startsWith("+") ? "text-[var(--live)]" : "text-[var(--error)]"}`}>
            {trend}
          </span>
        )}
        {hint && <div className="text-xs text-[var(--muted)] mono">{hint}</div>}
      </div>
    </div>
  );
}
