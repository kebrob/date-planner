import { sunsetAt } from '@/lib/sun';
import { addMinutes, minutesBetween } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { distanceKm, estimateTravel, maxDistanceKm, reachKm } from './geo';
import { isOpenDuring } from './opening-hours';
import { weightedShuffle } from './random';
import {
  chooseSlots,
  estimatedCost,
  fitsWeather,
  foodKind,
  formatFor,
  isCandidate,
  isFreeSearch,
  itemCost,
  needsPlace,
  score,
} from './rules';
import type {
  Activity,
  Plan,
  PlanContext,
  PlanFormat,
  PlanItem,
  PlanRequest,
  PlanWarning,
  Slot,
  Transport,
  Travel,
  WeatherSummary,
} from './types';
import { weatherFactor, windowWeather } from './weather';

const MAX_CANDIDATES_PER_SLOT = 15;
const MAX_ITEMS = 5;
// Free time left (before heading home) that is worth filling with another item.
const MIN_FILL_MINUTES = 90;
// Kept back for later slots so the first item cannot use up the whole budget.
const SLOT_RESERVE_EUR: Record<Slot, number> = { main: 0, meal: 25, snack: 8 };
// Likewise time, including a short way between stops.
const SLOT_RESERVE_MIN: Record<Slot, number> = { main: 75, meal: 90, snack: 40 };
const STRETCH_FACTOR = 1.5;
// Without an explicit distance, the trip to the first stop may take about a quarter of the window.
const TRAVEL_SHARE_OF_WINDOW = 0.25;
const MIN_TRAVEL_MINUTES = 15;
const MAX_TRAVEL_MINUTES = 120;

/** Default radius around home when no distance is chosen; derived from the time window. */
export function autoRadiusKm(transport: Transport, windowMinutes: number, maxRadiusKm: number) {
  const minutes = Math.min(
    MAX_TRAVEL_MINUTES,
    Math.max(MIN_TRAVEL_MINUTES, windowMinutes * TRAVEL_SHARE_OF_WINDOW),
  );
  return Math.min(maxRadiusKm, reachKm(transport, minutes));
}

export function firstStopRadiusKm(request: PlanRequest, ctx: PlanContext): number {
  if (request.maxDistanceKm) {
    return Math.min(request.maxDistanceKm, maxDistanceKm(request.transport));
  }
  return autoRadiusKm(
    request.transport,
    minutesBetween(request.start, request.end),
    ctx.maxRadiusKm,
  );
}

// Around an explicit destination.
const AREA_RADIUS_KM: Record<Transport, number> = {
  walk: 2,
  bike: 6,
  deutschlandticket: 8,
  car: 15,
};

/** Default radius around a chosen destination. */
export function autoAreaRadiusKm(transport: Transport): number {
  return AREA_RADIUS_KM[transport];
}
// Max distance to the next stop when moving away from home/destination.
const LEG_RADIUS_KM: Record<Transport, number> = {
  walk: 2,
  bike: 6,
  deutschlandticket: 10,
  car: 20,
};
// Stops on the way towards home/destination may be further away, with this much detour allowed.
const CORRIDOR_DETOUR = 1.25;

export const FALLBACK_ACTIVITY: Activity = {
  id: 'builtin-cozy-night',
  title: 'Cozy night in',
  description: 'Pick a movie together, make popcorn and get comfortable.',
  category: 'home',
  tags: ['chill', 'home', 'indoor'],
  costMinEur: 0,
  costMaxEur: 10,
  durationMinutes: 150,
  weather: {},
  transports: [],
  atHome: true,
  placeType: null,
  placeQuery: null,
  timesOfDay: [],
  seasons: [],
  preparation: 'Snacks and a movie shortlist',
};

type State = {
  cursor: Date;
  location: LatLng;
  atHomeLocation: boolean;
  reachedArea: boolean;
  spentEur: number;
  used: Set<string>;
  /** Paid place searches, including free ones that a paid provider answered. */
  lookups: number;
  freeLookups: number;
  /** A free search was answered by a paid provider; further free searches need paid quota. */
  freeFallsBack: boolean;
  /** Places found during this plan, so retries (e.g. without reserves) cost no new lookups. */
  placeCache: Map<string, Place[]>;
  warnings: Set<PlanWarning>;
};

function routineFor(ctx: PlanContext, request: PlanRequest) {
  return ctx.routines.find((r) => r.transport === request.transport);
}

function travelTo(
  target: LatLng,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
): Travel | null {
  if (distanceKm(state.location, target) < 0.05) return null;
  const routine = state.atHomeLocation ? routineFor(ctx, request) : undefined;
  return estimateTravel(state.location, target, request.transport, routine);
}

const startsInArea = (request: PlanRequest) => Boolean(request.area && request.startInArea);
const endsInArea = (request: PlanRequest) => Boolean(request.area && request.endInArea);

function travelHome(location: LatLng, request: PlanRequest, ctx: PlanContext): Travel | null {
  if (endsInArea(request) || distanceKm(location, ctx.home) < 0.05) return null;
  return estimateTravel(location, ctx.home, request.transport, routineFor(ctx, request));
}

type Region = {
  /** Circle sent to the provider; only one area per lookup, so it is picked per search. */
  center: LatLng;
  radiusKm: number;
  accepts: (p: LatLng) => boolean;
  /** Places close to any of these points rank higher. */
  anchors: LatLng[];
};

// Share of searches that look along the way (near home / towards the goal) instead of the main spot.
const ALONG_THE_WAY_SHARE = 0.25;

const midpoint = (a: LatLng, b: LatLng): LatLng => ({
  lat: (a.lat + b.lat) / 2,
  lng: (a.lng + b.lng) / 2,
});

/**
 * Where the next venue may be: close to the current location, around the destination, or anywhere
 * along the way towards the goal (the destination until reached, then home). Keeps plans on a
 * route instead of zigzagging.
 */
function searchRegion(state: State, request: PlanRequest, ctx: PlanContext): Region {
  const current = state.location;
  const area = request.area && !state.reachedArea ? request.area.location : null;

  if (state.atHomeLocation && !area) {
    const radiusKm = firstStopRadiusKm(request, ctx);
    return {
      center: ctx.home,
      radiusKm,
      accepts: (p) => distanceKm(ctx.home, p) <= radiusKm,
      anchors: [ctx.home],
    };
  }

  const goal = area ?? (endsInArea(request) ? request.area!.location : ctx.home);
  const near = LEG_RADIUS_KM[request.transport];
  // A chosen distance is the radius around the destination; otherwise a default per transport.
  const areaRadius = request.maxDistanceKm ?? AREA_RADIUS_KM[request.transport];
  const span = distanceKm(current, goal);
  const accepts = (p: LatLng) =>
    distanceKm(current, p) <= near ||
    (area !== null && distanceKm(area, p) <= areaRadius) ||
    distanceKm(current, p) + distanceKm(p, goal) <= span * CORRIDOR_DETOUR + near / 2;
  const anchors = area ? [current, area] : [current];

  // A chosen destination is where the date starts; detours only happen on the way back.
  if (area) return { center: area, radiusKm: areaRadius, accepts, anchors };
  const alongTheWay = span > near && ctx.random() < ALONG_THE_WAY_SHARE;
  return alongTheWay
    ? { center: midpoint(current, goal), radiusKm: (span / 2) * CORRIDOR_DETOUR, accepts, anchors }
    : { center: current, radiusKm: near, accepts, anchors };
}

/** Optimistic stand-in venue: the point of the region closest to where we are. */
function probeFor(region: Region, state: State): Place {
  const d = distanceKm(region.center, state.location);
  const t = d > 0 ? Math.min(1, region.radiusKm / d) : 0;
  return {
    provider: 'osm',
    id: 'probe',
    name: '',
    location: {
      lat: region.center.lat + (state.location.lat - region.center.lat) * t,
      lng: region.center.lng + (state.location.lng - region.center.lng) * t,
    },
    openingHours: null,
  };
}

// Places rated as the problem of a past date stay possible, but only as a last resort.
const AVOIDED_PLACE_FACTOR = 0.02;

function rankPlaces(places: Place[], anchors: LatLng[], radiusKm: number, ctx: PlanContext) {
  // Distance dominates so consecutive stops stay close; rating breaks ties.
  const scale = Math.max(1, radiusKm / 3);
  const avoided = new Set(ctx.learning.avoidPlaces);
  return weightedShuffle(
    places,
    (p) => {
      const d = Math.min(...anchors.map((a) => distanceKm(a, p.location)));
      const penalty = avoided.has(`${p.provider}:${p.id}`) ? AVOIDED_PLACE_FACTOR : 1;
      return ((p.rating ?? 3.5) ** 2 / (1 + d / scale) ** 2) * penalty;
    },
    ctx.random,
  );
}

/** Weather during [start, end]; the whole-window summary when there is no hourly forecast. */
function weatherAt(ctx: PlanContext, start: Date, end: Date): WeatherSummary {
  return ctx.forecast.length > 0
    ? windowWeather(ctx.forecast, start, end, ctx.weather.reliability)
    : ctx.weather;
}

function lookupsLeft(activity: Activity, state: State, ctx: PlanContext): boolean {
  const paidLeft = state.lookups < ctx.maxPlaceLookups;
  return isFreeSearch(activity)
    ? state.freeLookups < ctx.maxFreePlaceLookups && (!state.freeFallsBack || paidLeft)
    : paidLeft;
}

/** Location of an item: home, its venue, or – for venue-less outdoor ideas – where we are. */
function targetOf(
  activity: Activity,
  place: Place | null,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
) {
  if (activity.atHome) return ctx.home;
  if (place) return place.location;
  return state.atHomeLocation && request.area && !state.reachedArea
    ? request.area.location
    : state.location;
}

type Pass = {
  /** Max cost of this item including travel there and back home. */
  limitEur: number;
  /** Extra items after the planned slots: prefer free ideas, stay out (no going home mid-trip). */
  filler: boolean;
  /** Going home is only allowed for the last planned item, never in the middle of an outing. */
  homeAllowed: boolean;
  /** Minutes kept free for the remaining planned slots. */
  reserveMinutes: number;
};

function makePass(
  state: State,
  request: PlanRequest,
  laterSlots: Slot[],
  stretch: boolean,
  filler = false,
): Pass {
  const budget = request.budgetEur * (stretch ? STRETCH_FACTOR : 1);
  const reserve = laterSlots.reduce((sum, s) => sum + SLOT_RESERVE_EUR[s], 0);
  return {
    limitEur: budget - state.spentEur - reserve,
    filler,
    homeAllowed: state.atHomeLocation || (!filler && laterSlots.length === 0),
    reserveMinutes: laterSlots.reduce((sum, s) => sum + SLOT_RESERVE_MIN[s], 0),
  };
}

// Longest acceptable gap before a sun-dependent idea (e.g. waiting for the sunset).
const MAX_SUN_WAIT_MINUTES = 90;

/**
 * Start time for an item arriving at `arrival`. Ideas tagged "sunset" must include the sunset,
 * "after_dark" ones start at least 45 min after it; both may wait a little for the right moment.
 */
function startFor(activity: Activity, arrival: Date, location: LatLng): Date | null {
  const sunset = activity.tags.includes('sunset')
    ? 'sunset'
    : activity.tags.includes('after_dark')
      ? 'after_dark'
      : null;
  if (!sunset) return arrival;
  const sunsetTime = sunsetAt(arrival, location);
  if (!sunsetTime) return null;
  const earliest =
    sunset === 'sunset'
      ? addMinutes(sunsetTime, -(activity.durationMinutes - 15))
      : addMinutes(sunsetTime, 45);
  const start = earliest > arrival ? earliest : arrival;
  if (minutesBetween(arrival, start) > MAX_SUN_WAIT_MINUTES) return null;
  if (sunset === 'sunset' && start > addMinutes(sunsetTime, -15)) return null;
  return start;
}

function schedule(
  slot: Slot,
  activity: Activity,
  place: Place | null,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
  pass: Pass,
): PlanItem | null {
  const target = targetOf(activity, place, state, request, ctx);
  const travel = travelTo(target, state, request, ctx);
  const start = startFor(activity, addMinutes(state.cursor, travel?.minutes ?? 0), target);
  if (!start) return null;
  const end = addMinutes(start, activity.durationMinutes);
  const back = travelHome(target, request, ctx);
  if (addMinutes(end, (back?.minutes ?? 0) + pass.reserveMinutes) > request.end) return null;

  const costEur = itemCost(activity, place) + (travel?.costEur ?? 0);
  if (costEur + (back?.costEur ?? 0) > pass.limitEur) return null;

  if (place?.openingHours && !isOpenDuring(place.openingHours, start, end)) return null;

  return {
    slot,
    activity,
    place,
    travelBefore: travel,
    start,
    end,
    costEur,
    openingHoursUnknown: place !== null && place.openingHours === null,
    alternatives: [],
  };
}

const MAX_ALTERNATIVES = 2;

async function fillSlot(
  slot: Slot,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
  format: PlanFormat,
  pass: Pass,
): Promise<PlanItem | null> {
  // Weather while the idea would take place, if it started now.
  const expected = new Map(
    ctx.activities.map((a) => [
      a.id,
      weatherAt(ctx, state.cursor, addMinutes(state.cursor, a.durationMinutes)),
    ]),
  );
  const candidates = ctx.activities.filter(
    (a) =>
      (pass.homeAllowed || !a.atHome) &&
      !(a.atHome && endsInArea(request)) &&
      isCandidate(a, {
        slot,
        slotStart: state.cursor,
        availableMinutes: minutesBetween(state.cursor, request.end) - pass.reserveMinutes,
        remainingBudgetEur: pass.limitEur,
        used: state.used,
        request,
        weather: expected.get(a.id)!,
        placeLookupsLeft:
          lookupsLeft(a, state, ctx) ||
          [...state.placeCache.keys()].some((k) => k.startsWith(`${a.id}|`)),
      }),
  );
  // Cheaper ideas get a boost relative to what is left, fillers strongly prefer free ones.
  const affordability = (a: Activity) => 1 / (1 + estimatedCost(a) / Math.max(10, pass.limitEur));
  const required = new Set((request.required ?? []).map((a) => a.id));
  const ordered = [
    // Requested ideas always come first; the rest is weighted by score.
    ...candidates.filter((a) => required.has(a.id)),
    ...weightedShuffle(
      candidates.filter((a) => !required.has(a.id)),
      (a) => {
        const conditions = expected.get(a.id)!.conditions ?? [];
        return (
          score(a, request.preferences, ctx.history, ctx.learning, conditions) *
          weatherFactor(a, conditions) *
          affordability(a) *
          (pass.filler && a.costMaxEur === 0 ? 3 : 1)
        );
      },
      ctx.random,
    ),
  ].slice(0, MAX_CANDIDATES_PER_SLOT);

  const region = searchRegion(state, request, ctx);
  const limitedRange = maxDistanceKm(request.transport) !== Infinity;

  // The exact start may be later (travel, waiting for the sunset), so check the weather again.
  const scheduled = (activity: Activity, place: Place | null) => {
    const item = schedule(slot, activity, place, state, request, ctx, pass);
    return item && fitsWeather(activity, weatherAt(ctx, item.start, item.end)) ? item : null;
  };

  for (const activity of ordered) {
    if (!needsPlace(activity)) {
      const item = scheduled(activity, null);
      if (item) return item;
      continue;
    }
    const cacheKey = `${activity.id}|${region.center.lat},${region.center.lng}|${region.radiusKm}`;
    let places = state.placeCache.get(cacheKey);
    if (!places) {
      // Don't spend a lookup on an idea that can't fit even at the closest point of the region.
      if (!schedule(slot, activity, probeFor(region, state), state, request, ctx, pass)) continue;
      if (!lookupsLeft(activity, state, ctx)) {
        state.warnings.add('place_lookup_limit_reached');
        continue;
      }
      const free = isFreeSearch(activity);
      if (free) state.freeLookups++;
      else state.lookups++;
      places = await ctx.findPlaces(activity, region.center, region.radiusKm).catch(() => []);
      // A free search that fell back to a paid provider counts as paid as well.
      if (free && places.some((p) => p.provider === 'google')) {
        state.lookups++;
        state.freeFallsBack = true;
      }
      state.placeCache.set(cacheKey, places);
    }
    const reachable = places.filter(
      (p) =>
        region.accepts(p.location) &&
        (!limitedRange || distanceKm(ctx.home, p.location) <= maxDistanceKm(request.transport)),
    );
    const ranked = rankPlaces(reachable, region.anchors, region.radiusKm, ctx);
    for (const place of ranked) {
      const item = scheduled(activity, place);
      if (!item) continue;
      item.alternatives = ranked
        .filter((p) => p !== place && schedule(slot, activity, p, state, request, ctx, pass))
        .slice(0, MAX_ALTERNATIVES);
      return item;
    }
  }
  return null;
}

/** Makes sure every requested idea has a slot of its kind (requested ones are placed first). */
function withRequiredSlots(slots: Slot[], required: Activity[]): Slot[] {
  const result = [...slots];
  for (const kind of ['main', 'meal', 'snack'] as const) {
    const needed = required.filter((a) => (foodKind(a) ?? 'main') === kind).length;
    const have = result.filter((s) => s === kind).length;
    for (let i = have; i < needed; i++) {
      if (kind === 'main') result.unshift(kind);
      else result.push(kind);
    }
  }
  return result;
}

/** Tries within budget first, then – if allowed – up to the stretched budget. */
async function fillWithStretch(
  slot: Slot,
  laterSlots: Slot[],
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
  format: PlanFormat,
  filler = false,
): Promise<PlanItem | null> {
  const normal = await fillSlot(
    slot,
    state,
    request,
    ctx,
    format,
    makePass(state, request, laterSlots, false, filler),
  );
  if (normal) return normal;
  const stretch = request.allowOverBudget ?? false;
  const stretched =
    stretch &&
    (await fillSlot(
      slot,
      state,
      request,
      ctx,
      format,
      makePass(state, request, laterSlots, true, filler),
    ));
  if (stretched || laterSlots.length === 0) return stretched || null;
  // Nothing fits while keeping time and money for later slots: rather plan this one alone.
  return fillSlot(slot, state, request, ctx, format, makePass(state, request, [], stretch, filler));
}

function freeMinutes(state: State, request: PlanRequest, ctx: PlanContext): number {
  const home = travelHome(state.location, request, ctx);
  return minutesBetween(state.cursor, request.end) - (home?.minutes ?? 0);
}

function apply(item: PlanItem, state: State, request: PlanRequest, ctx: PlanContext) {
  const target = targetOf(item.activity, item.place, state, request, ctx);
  state.cursor = item.end;
  state.spentEur += item.costEur;
  state.used.add(item.activity.id);
  state.atHomeLocation = distanceKm(target, ctx.home) < 0.05;
  state.location = target;
  if (
    request.area &&
    distanceKm(target, request.area.location) <=
      (request.maxDistanceKm ?? AREA_RADIUS_KM[request.transport])
  ) {
    state.reachedArea = true;
  }
  if (item.openingHoursUnknown) state.warnings.add('opening_hours_unknown');
}

/**
 * Builds a schedule for the request. All loops are bounded: at most `MAX_ITEMS` items, 15 candidates
 * per slot and attempt, and `maxPlaceLookups` + `maxFreePlaceLookups` place searches in total.
 */
export async function buildPlan(request: PlanRequest, ctx: PlanContext): Promise<Plan> {
  const duration = minutesBetween(request.start, request.end);
  const format = request.format ?? formatFor(duration);
  const state: State = {
    cursor: request.start,
    // Starting in the area: the first stop is still searched around its centre.
    location: startsInArea(request) ? request.area!.location : ctx.home,
    atHomeLocation: !startsInArea(request),
    reachedArea: false,
    spentEur: 0,
    used: new Set(),
    lookups: 0,
    freeLookups: 0,
    freeFallsBack: false,
    placeCache: new Map(),
    warnings: new Set(),
  };
  if (ctx.weather.reliability === 'none') state.warnings.add('forecast_unavailable');
  if (ctx.weather.reliability === 'low') state.warnings.add('forecast_unreliable');

  const slots = withRequiredSlots(
    request.slots ??
      chooseSlots(format, duration, request.food ?? 'auto', request.budgetEur, ctx.random),
    request.required ?? [],
  ).slice(0, MAX_ITEMS);
  const items: PlanItem[] = [];
  for (const [index, slot] of slots.entries()) {
    const later = slots.slice(index + 1);
    const kept = request.keep?.[index];
    const keptItem =
      kept &&
      schedule(
        slot,
        kept.activity,
        kept.place,
        state,
        request,
        ctx,
        makePass(state, request, later, request.allowOverBudget ?? false),
      );
    if (keptItem) keptItem.alternatives = kept.alternatives ?? [];
    const item = keptItem || (await fillWithStretch(slot, later, state, request, ctx, format));
    if (item) {
      items.push(item);
      apply(item, state, request, ctx);
    }
  }

  // Long days: fill remaining free time, preferring free or cheap ideas nearby.
  while (
    items.length > 0 &&
    items.length < MAX_ITEMS &&
    freeMinutes(state, request, ctx) >= MIN_FILL_MINUTES
  ) {
    const item = await fillWithStretch('main', [], state, request, ctx, format, true);
    if (!item) break;
    items.push(item);
    apply(item, state, request, ctx);
  }

  const missing = (request.required ?? []).filter((a) => !state.used.has(a.id));
  if (missing.length > 0) state.warnings.add('required_skipped');

  const food = request.food ?? 'auto';
  if ((food === 'meal' || food === 'snack') && !items.some((i) => i.slot === food)) {
    state.warnings.add('food_skipped');
  }

  if (items.length === 0) {
    const fallback = schedule(
      'main',
      FALLBACK_ACTIVITY,
      null,
      state,
      request,
      ctx,
      makePass(state, request, [], false),
    ) ?? {
      slot: 'main' as const,
      activity: FALLBACK_ACTIVITY,
      place: null,
      travelBefore: null,
      start: request.start,
      end: request.end,
      costEur: estimatedCost(FALLBACK_ACTIVITY),
      openingHoursUnknown: false,
      alternatives: [],
    };
    items.push(fallback);
    apply(fallback, state, request, ctx);
    state.warnings.add('fallback_used');
  }

  const home = travelHome(state.location, request, ctx);
  const totalCostEur = items.reduce((sum, i) => sum + i.costEur, 0) + (home?.costEur ?? 0);
  const overBudgetEur = Math.max(0, totalCostEur - request.budgetEur);
  if (overBudgetEur > 0) state.warnings.add('over_budget');
  return {
    format,
    startsInArea: startsInArea(request),
    items,
    travelHome: home,
    totalCostEur,
    overBudgetEur,
    weather: ctx.weather,
    warnings: [...state.warnings],
    placeLookups: state.lookups,
    freePlaceLookups: state.freeLookups,
  };
}
