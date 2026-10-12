import type { RatingValue } from '@/core/planner/learning';

export const RATING_OPTIONS: { value: RatingValue; emoji: string; label: string }[] = [
  { value: 'dislike', emoji: '👎', label: 'Not for us' },
  { value: 'like', emoji: '👍', label: 'Good' },
  { value: 'love', emoji: '❤️', label: 'Loved it' },
];

export const ratingEmoji = (rating: RatingValue | null) =>
  RATING_OPTIONS.find((o) => o.value === rating)?.emoji;
