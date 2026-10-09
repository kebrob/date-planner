import { localParts } from '@/lib/time';
import { weightedShuffle } from './random';
import type {
  Activity,
  FoodPreference,
  History,
  PlanFormat,
  PlanRequest,
  Season,
  Slot,
  TimeOfDay,
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

const PREFERENCE_BONUS = 0.6;
const SUGGESTED_PENALTY = 0.8;
const SUGGESTED_DECAY_DAYS = 7;
const ACCEPTED_PENALTY = 1.5;
const ACCEPTED_DECAY_DAYS = 30;
const MIN_WEIGHT = 0.05;

export function score(
  activity: Activity,
  preferences: string[],
  history: History,
  tagWeights: Record<string, number>,
): number {
  const preferenceMatches = activity.tags.filter((t) => preferences.includes(t)).length;
  const learned = activity.tags.reduce((sum, t) => sum + (tagWeights[t] ?? 0), 0);
  const suggested = history.daysSinceSuggested[activity.id];
  const accepted = history.daysSinceAccepted[activity.id];
  const recency =
    (suggested === undefined
      ? 0
      : SUGGESTED_PENALTY * Math.exp(-suggested / SUGGESTED_DECAY_DAYS)) +
    (accepted === undefined ? 0 : ACCEPTED_PENALTY * Math.exp(-accepted / ACCEPTED_DECAY_DAYS));
  return Math.max(MIN_WEIGHT, 1 + PREFERENCE_BONUS * preferenceMatches + learned - recency);
}

export function estimatedCost(activity: Activity): number {
  return Math.round((activity.costMinEur + activity.costMaxEur) / 2);
}
