import type { Learning, WeatherCondition } from './types';

export type RatingValue = 'dislike' | 'like' | 'love';

/** One planned item of a rated date that took place. */
export type RatedItem = {
  activityId: string;
  tags: string[];
  /** "provider:id" of the venue, if any. */
  place: string | null;
  itemRating: RatingValue | null;
  planRating: RatingValue | null;
  /** The venue, not the idea, was the problem. */
  placeBlamed: boolean;
  /** Weather while the item took place; empty when unknown. */
  conditions: WeatherCondition[];
  ageDays: number;
};

const VALUE: Record<RatingValue, number> = { dislike: -1, like: 0.4, love: 1 };
// A date rating says little about which item made it good or bad.
const INHERITED_WEIGHT = 0.5;
// Tastes change: a rating counts half after this many days.
const HALF_LIFE_DAYS = 180;
// Pseudo-ratings of 0 that pull sparse evidence towards neutral; tags need more evidence.
const ACTIVITY_PRIOR = 1;
const TAG_PRIOR = 3;
const TAG_SCALE = 0.5;
const SUGGEST_BLOCK_AFTER_DISLIKES = 2;

type Sum = { value: number; weight: number };

function add(sums: Map<string, Sum>, key: string, value: number, weight: number) {
  const sum = sums.get(key) ?? { value: 0, weight: 0 };
  sum.value += value * weight;
  sum.weight += weight;
  sums.set(key, sum);
}

/**
 * Derives scoring input from all ratings. Recomputed from scratch on every run, so changed or
 * removed ratings never leave traces.
 */
export function learn(items: RatedItem[]): Learning {
  const activities = new Map<string, Sum>();
  const tags = new Map<string, Sum>();
  const avoidPlaces = new Set<string>();

  for (const item of items) {
    const rating = item.itemRating ?? item.planRating;
    if (!rating) continue;
    if (item.placeBlamed && item.itemRating === 'dislike') {
      if (item.place) avoidPlaces.add(item.place);
      continue;
    }
    const weight =
      (item.itemRating ? 1 : INHERITED_WEIGHT) *
      0.5 ** (Math.max(0, item.ageDays) / HALF_LIFE_DAYS);
    const value = VALUE[rating];
    add(activities, item.activityId, value, weight);
    for (const context of ['any', ...item.conditions]) {
      for (const tag of item.tags) add(tags, `${context}|${tag}`, value, weight);
    }
  }

  const learning: Learning = { activity: {}, tags: {}, avoidPlaces: [...avoidPlaces] };
  for (const [id, sum] of activities) {
    learning.activity[id] = sum.value / (sum.weight + ACTIVITY_PRIOR);
  }
  for (const [key, sum] of tags) {
    const [context, tag] = key.split('|') as [string, string];
    (learning.tags[context] ??= {})[tag] = (TAG_SCALE * sum.value) / (sum.weight + TAG_PRIOR);
  }
  return learning;
}

/** Repeatedly disliked ideas are worth blocking; the app only suggests it. */
export function shouldSuggestBlock(items: RatedItem[], activityId: string): boolean {
  const dislikes = items.filter(
    (i) =>
      i.activityId === activityId && (i.itemRating ?? i.planRating) === 'dislike' && !i.placeBlamed,
  ).length;
  return dislikes >= SUGGEST_BLOCK_AFTER_DISLIKES;
}
