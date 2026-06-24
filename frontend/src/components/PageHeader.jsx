export default function PageHeader({ title, subtitle, right, testId }) {
  return (
    <div className="px-8 py-7 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]" data-testid={testId}>
      <div>
        {subtitle && <div className="label mb-1.5">{subtitle}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  );
}
