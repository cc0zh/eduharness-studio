const ROW_WIDTHS = ['92%', '82%', '72%', '62%'] as const;

export function EditorialSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  const bars = ROW_WIDTHS.slice(0, Math.min(rows, ROW_WIDTHS.length));
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 border border-dashed border-border-strong bg-surface-recessed/70 p-5"
    >
      <p className="text-xs tracking-wide text-muted">{label}</p>
      <div className="space-y-2.5" aria-hidden="true">
        {bars.map((width) => (
          <div key={width} className="h-2.5 animate-pulse rounded-xs bg-border" style={{ width }} />
        ))}
      </div>
    </div>
  );
}
