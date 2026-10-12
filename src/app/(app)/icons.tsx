/** "×" for closing panels and sheets; `large` for the bigger close buttons. */
export function CloseIcon({ large = false }: { large?: boolean }) {
  const size = large ? 14 : 12;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      stroke="currentColor"
      strokeWidth={large ? 2 : 1.7}
      strokeLinecap="round"
      aria-hidden
    >
      <path d={large ? 'm3 3 8 8M11 3 3 11' : 'm3 3 6 6M9 3 3 9'} />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 3 5 9l6 6" />
    </svg>
  );
}
