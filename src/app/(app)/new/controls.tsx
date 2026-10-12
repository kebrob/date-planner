'use client';

export const field = 'w-full rounded-2xl bg-white px-4 py-3 text-[15px] ring-1 ring-line';

export function StepHeading({ children }: { children: React.ReactNode }) {
  return <h1 className="text-[30px] leading-tight font-semibold tracking-tight">{children}</h1>;
}

export function Choice({
  selected,
  onClick,
  children,
  className = '',
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-3 text-sm font-medium ${
        selected ? 'bg-butter text-ink' : 'bg-cream text-ink hover:bg-butter/60'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function OptionRow({
  selected,
  onClick,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between rounded-3xl px-5 py-4 text-left ${
        selected ? 'bg-butter' : 'bg-white ring-1 ring-line hover:bg-cream'
      }`}
    >
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-mist">{hint}</span>
      </span>
      <span
        className={`grid h-6 w-6 place-items-center rounded-full border ${
          selected ? 'border-ink bg-ink text-white' : 'border-line'
        }`}
        aria-hidden
      >
        {selected && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m2.5 6.2 2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
