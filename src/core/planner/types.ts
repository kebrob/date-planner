import type { LatLng, Place } from '@/ports/places';
import type { WeatherHour } from '@/ports/weather';

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

export type WeatherCondition = 'rain' | 'snow' | 'sunny' | 'hot' | 'cold' | 'windy';

export type WeatherSummary = {
  reliability: 'good' | 'low' | 'none';
  dry: boolean | null;
  minTempC: number | null;
  maxTempC: number | null;
  /** Missing in summaries stored before conditions existed. */
  conditions?: WeatherCondition[];
};

export type History = {
  /** Days since the activity was last suggested / accepted. */
  daysSinceSuggested: Record<string, number>;
  daysSinceAccepted: Record<string, number>;
};

/** What past ratings say; derived from all ratings on every planning run. */
export type Learning = {
  /** Smoothed mean rating per activity, -1 (disliked) … 1 (loved); absent = never rated. */
  activity: Record<string, number>;
  /** Learned weight per context ('any' or a weather condition) and tag. */
  tags: Record<string, Record<string, number>>;
  /** Places rated as the problem of a date ("provider:id"); ranked far down. */
  avoidPlaces: string[];
};

/** An activity the user picked themselves, optionally with the venue they chose. */
export type ChosenStop = { activity: Activity; place: Place | null };

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
  /** With an area: start there instead of at home (already in town). */
  startInArea?: boolean;
  /** With an area: stay there afterwards instead of going home (e.g. a hotel). */
  endInArea?: boolean;
  /** Positions of added stops where any kind fits: an activity, else a snack, else a meal. */
  anyKindAt?: number[];
  /** A kept item that no longer fits gets a new suggestion (default); off = it is left out. */
  replaceUnfit?: boolean;
  /** Fill long free gaps with extra items (default); off once the user removed stops. */
  fillGaps?: boolean;
  /** Allows going up to 50 % over budget if nothing else fits; flagged in the plan. */
  allowOverBudget?: boolean;
  /** Slot layout of a previous plan; used when re-rolling a single item so `keep` indices match. */
  slots?: Slot[];
  /** Max straight-line distance from home for the first stop; null/undefined = derived from time. */
  maxDistanceKm?: number | null;
  /** Ad-hoc ideas that must be part of the plan (e.g. "shopping" requested in the chat). */
  required?: Activity[];
  /** Chosen stops at a fixed start; the rest of the plan is fitted before, between and after. */
  anchors?: (ChosenStop & { start: Date })[];
  /** Chosen stops for item positions, e.g. replacing one stop while keeping the others. */
  pins?: Record<number, ChosenStop>;
  /** Venues the user picked for ideas in `required`; used instead of a search. */
  chosenPlaces?: Record<string, Place>;
  /** Activities rejected during this planning session. */
  excludeActivityIds: string[];
  /** Items kept from a previous plan when re-rolling a single item, keyed by item index. */
  keep?: Record<
    number,
    {
      activity: Activity;
      place: Place | null;
      alternatives?: Place[];
      /** Chosen for a set time: stays a fixed block when the rest is re-planned. */
      at?: Date;
    }
  >;
};

export type PlanContext = {
  home: LatLng;
  maxRadiusKm: number;
  routines: TravelRoutine[];
  activities: Activity[];
  history: History;
  /** Summary for the whole window (display, reliability). */
  weather: WeatherSummary;
  /** Hourly forecast for per-item weather; empty = use `weather` for every item. */
  forecast: WeatherHour[];
  learning: Learning;
  /** Paid place searches per plan. */
  maxPlaceLookups: number;
  /** Additional searches for free ideas, which go to a free provider first. */
  maxFreePlaceLookups: number;
  findPlaces: (activity: Activity, center: LatLng, radiusKm: number) => Promise<Place[]>;
  random: () => number;
};

export type TravelMode = 'walk' | 'bike' | 'car' | 'local_transit' | 'train';

/** A real train for a leg; times are ISO strings so the leg survives JSON storage. */
export type TrainLeg = {
  line: string;
  category: string;
  /** Covered by the Deutschlandticket. */
  regional: boolean;
  from: { eva: string; name: string };
  to: { eva: string; name: string };
  /** Timetable stop id at `from`, for live updates. */
  stopId: string;
  /** When to leave the previous place to catch the train. */
  leaveAt: string;
  plannedDeparture: string;
  departure: string;
  plannedArrival: string;
  arrival: string;
  platform: string | null;
  plannedPlatform: string | null;
  /** Times derived from another day's timetable (date too far ahead); refreshed later. */
  expected?: boolean;
};

export type Travel = {
  minutes: number;
  distanceKm: number;
  mode: TravelMode;
  costEur: number;
  /** First train of the leg. */
  train?: TrainLeg;
  /** Further trains after changing, in order. */
  transfers?: TrainLeg[];
};

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

export const PLAN_WARNINGS = [
  'forecast_unreliable',
  'forecast_unavailable',
  'opening_hours_unknown',
  'place_lookup_limit_reached',
  'fallback_used',
  'food_skipped',
  'over_budget',
  'required_skipped',
  'chosen_time_moved',
  'chosen_closed',
  'places_daily_limit',
  'train_times_adjusted',
  'train_ticket_needed',
  'train_late_return',
  'trains_unavailable',
] as const;
export type PlanWarning = (typeof PLAN_WARNINGS)[number];

export type Plan = {
  format: PlanFormat;
  /** The first leg leaves from the area instead of home. */
  startsInArea: boolean;
  items: PlanItem[];
  travelHome: Travel | null;
  totalCostEur: number;
  overBudgetEur: number;
  weather: WeatherSummary;
  warnings: PlanWarning[];
  /** Paid place searches. */
  placeLookups: number;
  freePlaceLookups: number;
};
