export type FaceVariant = 'happy' | 'calm' | 'excited' | 'love' | 'curious' | 'cozy';

/** Hand-drawn style faces for the mood card; stroke-only so they work on every pastel. */
export function Face({ variant }: { variant: FaceVariant }) {
  const eye = (cx: number) => {
    switch (variant) {
      case 'calm':
      case 'cozy':
        return <path d={`M${cx - 9} 46q9 7 18 0`} />;
      case 'love':
        return (
          <path
            d={`M${cx} 52c-7-5-11-9-11-13a5.5 5.5 0 0 1 11-2 5.5 5.5 0 0 1 11 2c0 4-4 8-11 13z`}
            fill="#E9967A"
            stroke="none"
          />
        );
      case 'excited':
        return (
          <>
            <circle cx={cx} cy={44} r={9} fill="white" />
            <circle cx={cx + 1} cy={45} r={5} fill="currentColor" stroke="none" />
            <path d={`M${cx - 8} 30l-3-5M${cx} 28v-6M${cx + 8} 30l3-5`} />
          </>
        );
      case 'curious':
        return (
          <>
            <circle cx={cx} cy={44} r={8} fill="white" />
            <circle cx={cx + 3} cy={42} r={4} fill="currentColor" stroke="none" />
          </>
        );
      default:
        return (
          <>
            <circle cx={cx} cy={44} r={8} fill="white" />
            <circle cx={cx} cy={45} r={4.5} fill="currentColor" stroke="none" />
          </>
        );
    }
  };

  const mouth = {
    happy: <path d="M48 66q12 12 24 0" />,
    calm: <path d="M50 68q10 6 20 0" />,
    cozy: <path d="M50 66q10 8 20 0" />,
    excited: <path d="M46 63q14 18 28 0z" fill="#F4A68D" />,
    love: <path d="M48 66q12 10 24 0" />,
    curious: <circle cx={60} cy={68} r={4} />,
  }[variant];

  return (
    <svg
      viewBox="0 0 120 100"
      className="h-28 w-36 text-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {eye(42)}
      {eye(78)}
      <ellipse cx={28} cy={60} rx={7} ry={4} fill="#F4A68D" stroke="none" opacity={0.7} />
      <ellipse cx={92} cy={60} rx={7} ry={4} fill="#F4A68D" stroke="none" opacity={0.7} />
      {mouth}
    </svg>
  );
}
