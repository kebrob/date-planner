import type { LatLng, Place } from '@/ports/places';

export type Transport = 'deutschlandticket' | 'car' | 'walk' | 'bike';
export type PlanFormat = 'single' | 'evening' | 'day';
export type Slot = 'main' | 'meal' | 'snack';
export type FoodPreference = 'auto' | 'none' | 'snack' | 'meal';
export const CUISINES = [
  'bavarian',
  'italian',
  'asian',
  'burger',
  'mexican',
  'greek',
  'indian',
  'veggie',
] as const;
export type Cuisine = (typeof CUISINES)[number];
export const MOOD_TAGS = [
  'indoor',
  'outdoor',
  'active',
  'chill',
  'social',
  'romantic',
  'culture',
  'creative',
  'home',
] as const;

export type Activity = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  costMinEur: number;
  costMaxEur: number;
  durationMinutes: number;
  weather: { dryOnly?: boolean; minTempC?: number; maxTempC?: number };
  /** Empty = any transport. */
  transports: Transport[];
  atHome: boolean;
  placeType: string | null;
  placeQuery: string | null;
  /** Empty = any time of day. */
  timesOfDay: TimeOfDay[];
  /** Empty = all seasons. */
  seasons: Season[];
  preparation: string | null;
};

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type TravelRoutine = {
  transport: Transport;
  firstLegMinutes: number;
  bufferMinutes: number;
};

export type WeatherSummary = {
  reliability: 'good' | 'low' | 'none';
  dry: boolean | null;
  minTempC: number | null;
  maxTempC: number | null;
};

export type History = {
  /** Days since the activity was last suggested / accepted. */
  daysSinceSuggested: Record<string, number>;
  daysSinceAccepted: Record<string, number>;
};

export type PlanRequest = {
  start: Date;
  end: Date;
  budgetEur: number;
  transport: Transport;
  preferences: string[];
  format?: PlanFormat;
  /** Defaults to 'auto'. */
  food?: FoodPreference;
  /** Restricts proper meals to activities tagged with this cuisine. */
  cuisine?: Cuisine | null;
  /** Optional destination; the first venue is searched around it instead of home. */
  area?: { name: string; location: LatLng } | null;
  /** Allows going up to 50 % over budget if nothing else fits; flagged in the plan. */
  allowOverBudget?: boolean;
  /** Slot layout of a previous plan; used when re-rolling a single item so `keep` indices match. */
  slots?: Slot[];
  /** Activities rejected during this planning session. */
  excludeActivityIds: string[];
  /** Items kept from a previous plan when re-rolling a single item, keyed by item index. */
  keep?: Record<number, { activity: Activity; place: Place | null; alternatives?: Place[] }>;
};

export type PlanContext = {
  home: LatLng;
  maxRadiusKm: number;
  routines: TravelRoutine[];
  activities: Activity[];
  history: History;
  weather: WeatherSummary;
  tagWeights: Record<string, number>;
  maxPlaceLookups: number;
  findPlaces: (activity: Activity, center: LatLng, radiusKm: number) => Promise<Place[]>;
  random: () => number;
};

export type TravelMode = 'walk' | 'bike' | 'car' | 'local_transit' | 'train';

export type Travel = { minutes: number; distanceKm: number; mode: TravelMode; costEur: number };

export type PlanItem = {
  slot: Slot;
  activity: Activity;
  place: Place | null;
  travelBefore: Travel | null;
  start: Date;
  end: Date;
  costEur: number;
  openingHoursUnknown: boolean;
  /** Other venues for the same activity that would fit as well (max. 2). */
  alternatives: Place[];
};

export type PlanWarning =
  | 'forecast_unreliable'
  | 'forecast_unavailable'
  | 'opening_hours_unknown'
  | 'place_lookup_limit_reached'
  | 'fallback_used'
  | 'food_skipped'
  | 'over_budget';

export type Plan = {
  format: PlanFormat;
  items: PlanItem[];
  travelHome: Travel | null;
  totalCostEur: number;
  overBudgetEur: number;
  weather: WeatherSummary;
  warnings: PlanWarning[];
  placeLookups: number;
};
