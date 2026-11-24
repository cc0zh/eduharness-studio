export function EvidenceLink({
  number,
  onClick,
  bracketed = false,
}: {
  number: number;
  onClick: () => void;
  bracketed?: boolean;
}) {
  const label = `#${number}`;
  return (
    <button
      type="button"
      data-evidence-link={number}
      onClick={onClick}
      className="inline-flex min-h-5 cursor-pointer items-center rounded-md border border-accent/25 bg-accent-soft/55 px-1.5 font-mono text-[10.5px] font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      {bracketed ? `[${label}]` : label}
    </button>
  );
}
