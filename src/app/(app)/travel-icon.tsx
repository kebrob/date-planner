export type TravelIconKind =
  'walk' | 'bike' | 'car' | 'local_transit' | 'train' | 'bus' | 'flight' | 'other';

const PATHS: Record<TravelIconKind, React.ReactNode> = {
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.5" />
      <path d="m10 21 2-6 3 3v3M12 15l-1-5 3-1 2 3h3M11 10l-3 2v3" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="m6 16 4-7h5l3 7M10 9l2 7h-6M14 6h2" />
    </>
  ),
  car: (
    <>
      <path d="M4 16v-3l2-5h12l2 5v3zM4 13h16" />
      <circle cx="8" cy="16.5" r="1.5" />
      <circle cx="16" cy="16.5" r="1.5" />
    </>
  ),
  local_transit: (
    <>
      <rect x="6" y="3" width="12" height="14" rx="3" />
      <path d="M6 10h12M9 21l1.5-4M15 21l-1.5-4" />
    </>
  ),
  train: (
    <>
      <rect x="6" y="3" width="12" height="14" rx="3" />
      <path d="M6 10h12M9 21l1.5-4M15 21l-1.5-4M10 13.5h.01M14 13.5h.01" />
    </>
  ),
  bus: (
    <>
      <rect x="4" y="4" width="16" height="13" rx="2.5" />
      <path d="M4 11h16M7 17v3M17 17v3M8 14h.01M16 14h.01" />
    </>
  ),
  flight: <path d="M2.5 13.5 21 7l-2 3.5-9 2.5-2 5-2-1 .5-3.5-4 .5z" />,
  other: <path d="M5 12h14M13 6l6 6-6 6" />,
};

/** Line icon for a way of travelling, shared by date plans and trips. */
export function TravelIcon({ kind, size = 16 }: { kind: TravelIconKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[kind]}
    </svg>
  );
}
