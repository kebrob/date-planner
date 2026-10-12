import { localParts } from '@/lib/time';
import { TEXT_SEARCH_TYPE } from '@/ports/place-types';
import type { Place } from '@/ports/places';
import { weightedShuffle } from './random';
import type {
  Activity,
  FoodPreference,
  History,
  Learning,
  PlanFormat,
  PlanRequest,
  Season,
  Slot,
  TimeOfDay,
  WeatherCondition,
  WeatherSummary,
} from './types';

export function formatFor(durationMinutes: number): PlanFormat {
  if (durationMinutes < 180) return 'single';
  if (durationMinutes <= 360) return 'evening';
  return 'day';
}

type Template = { slots: Slot[]; weight: number };

// Low budgets make a proper meal unlikely to fit; such templates are skipped in 'auto'.
const MEAL_MIN_BUDGET_EUR = 40;

function templates(
  format: PlanFormat,
  durationMinutes: number,
): Record<FoodPreference, Template[]> {
  switch (format) {
    case 'single':
      return {
        none: [{ slots: ['main'], weight: 1 }],
        snack: [
          { slots: ['main', 'snack'], weight: 1 },
          { slots: ['snack', 'main'], weight: 1 },
        ],
        meal: [
          { slots: ['main', 'meal'], weight: 1 },
          { slots: ['meal'], weight: 1 },
        ],
        auto: [
          { slots: ['main'], weight: 6 },
          { slots: ['main', 'snack'], weight: 2 },
          { slots: ['snack', 'main'], weight: 2 },
        ],
      };
    case 'evening':
      return {
        none: [{ slots: ['main', 'main'], weight: 1 }],
        snack: [
          { slots: ['main', 'snack'], weight: 1 },
          { slots: ['snack', 'main'], weight: 1 },
        ],
        meal: [
          { slots: ['main', 'meal'], weight: 1 },
          { slots: ['meal', 'main'], weight: 1 },
        ],
        auto: [
          { slots: ['main', 'meal'], weight: 3 },
          { slots: ['meal', 'main'], weight: 2 },
          { slots: ['main', 'snack'], weight: 2 },
          { slots: ['snack', 'main'], weight: 1 },
          { slots: ['main', 'main'], weight: 2 },
        ],
      };
    case 'day': {
      const long = durationMinutes > 600;
      return {
        none: [{ slots: long ? ['main', 'main', 'main'] : ['main', 'main'], weight: 1 }],
        snack: [
          {
            slots: long ? ['main', 'snack', 'main', 'main'] : ['main', 'snack', 'main'],
            weight: 1,
          },
        ],
        meal: [
          { slots: long ? ['main', 'meal', 'main', 'meal'] : ['main', 'meal', 'main'], weight: 1 },
        ],
        auto: [
          { slots: long ? ['main', 'meal', 'main', 'snack'] : ['main', 'meal', 'main'], weight: 3 },
          {
            slots: long ? ['meal', 'main', 'snack', 'main'] : ['meal', 'main', 'snack'],
            weight: 2,
          },
          {
            slots: long ? ['main', 'snack', 'main', 'meal'] : ['main', 'snack', 'main'],
            weight: 2,
          },
        ],
      };
    }
  }
}

export function chooseSlots(
  format: PlanFormat,
  durationMinutes: number,
  food: FoodPreference,
  budgetEur: number,
  random: () => number,
): Slot[] {
  let options = templates(format, durationMinutes)[food];
  if (food === 'auto' && budgetEur < MEAL_MIN_BUDGET_EUR) {
    const withoutMeal = options.filter((t) => !t.slots.includes('meal'));
    if (withoutMeal.length > 0) options = withoutMeal;
  }
  return weightedShuffle(options, (t) => t.weight, random)[0]!.slots;
}

export function foodKind(activity: Activity): 'meal' | 'snack' | null {
  if (activity.category !== 'food') return null;
  return activity.tags.includes('snack') ? 'snack' : 'meal';
}

export function timeOfDay(date: Date): TimeOfDay {
  const { hour } = localParts(date);
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function seasonOf(date: Date): Season {
  const { month } = localParts(date);
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function fitsWeather(activity: Activity, weather: WeatherSummary): boolean {
  const req = activity.weather;
  if (req.dryOnly && weather.dry === false) return false;
  if (req.minTempC !== undefined && weather.minTempC !== null && weather.minTempC < req.minTempC)
    return false;
  if (req.maxTempC !== undefined && weather.maxTempC !== null && weather.maxTempC > req.maxTempC)
    return false;
  return true;
}

export type CandidateFilter = {
  slot: Slot;
  slotStart: Date;
  availableMinutes: number;
  remainingBudgetEur: number;
  used: Set<string>;
  request: PlanRequest;
  weather: WeatherSummary;
  placeLookupsLeft: boolean;
};

export function isCandidate(activity: Activity, f: CandidateFilter): boolean {
  const kind = foodKind(activity);
  if (f.slot === 'main' ? kind !== null : kind !== f.slot) return false;
  if (f.slot === 'meal' && f.request.cuisine && !activity.tags.includes(f.request.cuisine)) {
    return false;
  }
  // An explicit destination means going out; home activities only serve as last-resort fallback.
  if (activity.atHome && f.request.area) return false;
  if (f.used.has(activity.id) || f.request.excludeActivityIds.includes(activity.id)) return false;
  if (activity.costMinEur > f.remainingBudgetEur) return false;
  if (activity.durationMinutes > f.availableMinutes) return false;
  if (
    !activity.atHome &&
    activity.transports.length > 0 &&
    !activity.transports.includes(f.request.transport)
  ) {
    return false;
  }
  if (activity.seasons.length > 0 && !activity.seasons.includes(seasonOf(f.slotStart)))
    return false;
  if (activity.timesOfDay.length > 0 && !activity.timesOfDay.includes(timeOfDay(f.slotStart)))
    return false;
  if (!fitsWeather(activity, f.weather)) return false;
  if (needsPlace(activity) && !f.placeLookupsLeft) return false;
  return true;
}

export function needsPlace(activity: Activity): boolean {
  return !activity.atHome && activity.placeType !== null;
}

/** Free ideas are searched with a free provider first; free-text stops ('custom') need a paid one. */
export function isFreeSearch(activity: Activity): boolean {
  return activity.costMaxEur === 0 && activity.placeType !== TEXT_SEARCH_TYPE;
}

const PREFERENCE_BONUS = 2;
const SUGGESTED_PENALTY = 0.8;
const SUGGESTED_DECAY_DAYS = 7;
const ACCEPTED_PENALTY = 1.5;
const ACCEPTED_DECAY_DAYS = 30;
const MIN_WEIGHT = 0.05;
// A loved activity (mean 1) weighs 2^1.5 ≈ 2.8×, a disliked one (-1) ≈ 0.35×.
const RATING_STRENGTH = 1.5;
// Learned tag weights may shift the score by at most this much (one preference match = 2).
const MAX_TAG_EFFECT = 1.5;
// Ideas that were never done or rated get a small boost so favourites don't crowd them out.
const NOVELTY_BONUS = 1.15;

export const NO_LEARNING: Learning = { activity: {}, tags: {}, avoidPlaces: [] };

export function score(
  activity: Activity,
  preferences: string[],
  history: History,
  learning: Learning = NO_LEARNING,
  conditions: WeatherCondition[] = [],
): number {
  const preferenceMatches = activity.tags.filter((t) => preferences.includes(t)).length;
  const contexts = ['any', ...conditions];
  const tagEffect = activity.tags.reduce(
    (sum, t) => sum + contexts.reduce((s, c) => s + (learning.tags[c]?.[t] ?? 0), 0),
    0,
  );
  const rating = learning.activity[activity.id];
  const suggested = history.daysSinceSuggested[activity.id];
  const accepted = history.daysSinceAccepted[activity.id];
  // Loved activities may come back sooner.
  const acceptedPenalty = ACCEPTED_PENALTY * (1 - 0.5 * Math.max(0, rating ?? 0));
  const recency =
    (suggested === undefined
      ? 0
      : SUGGESTED_PENALTY * Math.exp(-suggested / SUGGESTED_DECAY_DAYS)) +
    (accepted === undefined ? 0 : acceptedPenalty * Math.exp(-accepted / ACCEPTED_DECAY_DAYS));
  const base = Math.max(
    MIN_WEIGHT,
    1 +
      PREFERENCE_BONUS * preferenceMatches +
      Math.max(-MAX_TAG_EFFECT, Math.min(MAX_TAG_EFFECT, tagEffect)) -
      recency,
  );
  const novelty = rating === undefined && accepted === undefined ? NOVELTY_BONUS : 1;
  return base * 2 ** (RATING_STRENGTH * (rating ?? 0)) * novelty;
}

export function estimatedCost(activity: Activity): number {
  return Math.round((activity.costMinEur + activity.costMaxEur) / 2);
}

// Plans are for two people; venue prices are per person.
const PEOPLE = 2;

/** Cost of an item: the venue's own price range for food when known, else the activity estimate. */
export function itemCost(activity: Activity, place: Place | null): number {
  const price = activity.category === 'food' ? place?.pricePerPerson : undefined;
  if (!price) return estimatedCost(activity);
  const perPerson = price.max === null ? price.min : (price.min + price.max) / 2;
  return Math.round(perPerson * PEOPLE);
}
