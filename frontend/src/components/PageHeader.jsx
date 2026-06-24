export default function PageHeader({ title, subtitle, right, testId }) {
  return (
    <div className="border-b border-[var(--border)] px-8 py-6 flex items-center justify-between" data-testid={testId}>
      <div>
        <div className="label mb-1">{subtitle}</div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  );
}
