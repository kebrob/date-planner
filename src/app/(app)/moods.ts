import type { FaceVariant } from './new/face';

/** Mood choices with their planner tag; shared by the date wizard and trips. */
export const MOODS: { tag: string; label: string; face: FaceVariant; tint: string }[] = [
  { tag: 'chill', label: 'Cozy', face: 'cozy', tint: 'bg-mint' },
  { tag: 'romantic', label: 'Romantic', face: 'love', tint: 'bg-blush' },
  { tag: 'active', label: 'Active', face: 'excited', tint: 'bg-butter' },
  { tag: 'social', label: 'Social', face: 'happy', tint: 'bg-lilac' },
  { tag: 'culture', label: 'Curious', face: 'curious', tint: 'bg-cream' },
  { tag: 'creative', label: 'Creative', face: 'curious', tint: 'bg-lilac' },
  { tag: 'outdoor', label: 'Outdoors', face: 'happy', tint: 'bg-mint' },
  { tag: 'indoor', label: 'Indoors', face: 'calm', tint: 'bg-cream' },
  { tag: 'home', label: 'At home', face: 'cozy', tint: 'bg-blush' },
];
