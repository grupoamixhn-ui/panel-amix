export default function PageHeader({ title, subtitle, right, testId }) {
  return (
    <div className="px-4 md:px-8 py-5 md:py-7 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)]" data-testid={testId}>
      <div className="min-w-0">
        {subtitle && <div className="label mb-1.5">{subtitle}</div>}
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight truncate">{title}</h1>
      </div>
      {right && <div className="flex-shrink-0">{right}</div>}
    </div>
  );
}
