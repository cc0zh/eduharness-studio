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
      className="inline-flex min-h-6 items-center rounded-md border border-primary/20 bg-primary-soft px-1.5 font-mono text-[11px] font-semibold text-primary hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {bracketed ? `[${label}]` : label}
    </button>
  );
}
