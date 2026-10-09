import { addMinutes, minutesBetween } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { distanceKm, estimateTravel, maxDistanceKm } from './geo';
import { isOpenDuring } from './opening-hours';
import { weightedShuffle } from './random';
import { chooseSlots, estimatedCost, formatFor, isCandidate, needsPlace, score } from './rules';
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
} from './types';

const MAX_CANDIDATES_PER_SLOT = 15;
// First venue when starting from home, by plan size.
const HOME_RADIUS_KM: Record<PlanFormat, number> = { single: 25, evening: 40, day: 120 };
// Around an explicit destination.
const AREA_RADIUS_KM: Record<Transport, number> = {
  walk: 2,
  bike: 6,
  deutschlandticket: 8,
  car: 15,
};
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
  budget: number;
  used: Set<string>;
  lookups: number;
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

function travelHome(location: LatLng, request: PlanRequest, ctx: PlanContext): Travel | null {
  if (distanceKm(location, ctx.home) < 0.05) return null;
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
function searchRegion(
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
  format: PlanFormat,
): Region {
  const current = state.location;
  const area = request.area && !state.reachedArea ? request.area.location : null;

  if (state.atHomeLocation && !area) {
    const radiusKm = Math.min(
      ctx.maxRadiusKm,
      HOME_RADIUS_KM[format],
      maxDistanceKm(request.transport),
    );
    return {
      center: ctx.home,
      radiusKm,
      accepts: (p) => distanceKm(ctx.home, p) <= radiusKm,
      anchors: [ctx.home],
    };
  }

  const goal = area ?? ctx.home;
  const near = LEG_RADIUS_KM[request.transport];
  const areaRadius = AREA_RADIUS_KM[request.transport];
  const span = distanceKm(current, goal);
  const accepts = (p: LatLng) =>
    distanceKm(current, p) <= near ||
    (area !== null && distanceKm(area, p) <= areaRadius) ||
    distanceKm(current, p) + distanceKm(p, goal) <= span * CORRIDOR_DETOUR + near / 2;
  const anchors = area ? [current, area] : [current];

  const alongTheWay = span > near && ctx.random() < ALONG_THE_WAY_SHARE;
  if (area) {
    // Usually start at the destination; sometimes stop near the current place first.
    return alongTheWay
      ? { center: current, radiusKm: near, accepts, anchors }
      : { center: area, radiusKm: areaRadius, accepts, anchors };
  }
  return alongTheWay
    ? { center: midpoint(current, goal), radiusKm: (span / 2) * CORRIDOR_DETOUR, accepts, anchors }
    : { center: current, radiusKm: near, accepts, anchors };
}

function rankPlaces(places: Place[], anchors: LatLng[], radiusKm: number, random: () => number) {
  // Distance dominates so consecutive stops stay close; rating breaks ties.
  const scale = Math.max(1, radiusKm / 3);
  return weightedShuffle(
    places,
    (p) => {
      const d = Math.min(...anchors.map((a) => distanceKm(a, p.location)));
      return (p.rating ?? 3.5) ** 2 / (1 + d / scale) ** 2;
    },
    random,
  );
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

function schedule(
  slot: Slot,
  activity: Activity,
  place: Place | null,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
): PlanItem | null {
  const target = targetOf(activity, place, state, request, ctx);
  const travel = travelTo(target, state, request, ctx);
  const start = addMinutes(state.cursor, travel?.minutes ?? 0);
  const end = addMinutes(start, activity.durationMinutes);
  const back = travelHome(target, request, ctx);
  if (addMinutes(end, back?.minutes ?? 0) > request.end) return null;

  const costEur = estimatedCost(activity) + (travel?.costEur ?? 0);
  if (costEur + (back?.costEur ?? 0) > state.budget) return null;

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
  };
}

async function fillSlot(
  slot: Slot,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
  format: PlanFormat,
): Promise<PlanItem | null> {
  const candidates = ctx.activities.filter((a) =>
    isCandidate(a, {
      slot,
      slotStart: state.cursor,
      availableMinutes: minutesBetween(state.cursor, request.end),
      remainingBudgetEur: state.budget,
      used: state.used,
      request,
      weather: ctx.weather,
      placeLookupsLeft: state.lookups < ctx.maxPlaceLookups,
    }),
  );
  const ordered = weightedShuffle(
    candidates,
    (a) => score(a, request.preferences, ctx.history, ctx.tagWeights),
    ctx.random,
  ).slice(0, MAX_CANDIDATES_PER_SLOT);

  const region = searchRegion(state, request, ctx, format);
  const limitedRange = maxDistanceKm(request.transport) !== Infinity;

  for (const activity of ordered) {
    if (!needsPlace(activity)) {
      const item = schedule(slot, activity, null, state, request, ctx);
      if (item) return item;
      continue;
    }
    if (state.lookups >= ctx.maxPlaceLookups) {
      state.warnings.add('place_lookup_limit_reached');
      continue;
    }
    state.lookups++;
    const places = await ctx.findPlaces(activity, region.center, region.radiusKm).catch(() => []);
    const reachable = places.filter(
      (p) =>
        region.accepts(p.location) &&
        (!limitedRange || distanceKm(ctx.home, p.location) <= maxDistanceKm(request.transport)),
    );
    for (const place of rankPlaces(reachable, region.anchors, region.radiusKm, ctx.random)) {
      const item = schedule(slot, activity, place, state, request, ctx);
      if (item) return item;
    }
  }
  return null;
}

function apply(item: PlanItem, state: State, request: PlanRequest, ctx: PlanContext) {
  const target = targetOf(item.activity, item.place, state, request, ctx);
  state.cursor = item.end;
  state.budget -= item.costEur;
  state.used.add(item.activity.id);
  state.atHomeLocation = distanceKm(target, ctx.home) < 0.05;
  state.location = target;
  if (
    request.area &&
    distanceKm(target, request.area.location) <= AREA_RADIUS_KM[request.transport]
  ) {
    state.reachedArea = true;
  }
  if (item.openingHoursUnknown) state.warnings.add('opening_hours_unknown');
}

/**
 * Builds a schedule for the request. All loops are bounded: at most 4 slots, 15 candidates per slot
 * and `maxPlaceLookups` place searches in total.
 */
export async function buildPlan(request: PlanRequest, ctx: PlanContext): Promise<Plan> {
  const duration = minutesBetween(request.start, request.end);
  const format = request.format ?? formatFor(duration);
  const state: State = {
    cursor: request.start,
    location: ctx.home,
    atHomeLocation: true,
    reachedArea: false,
    budget: request.budgetEur,
    used: new Set(),
    lookups: 0,
    warnings: new Set(),
  };
  if (ctx.weather.reliability === 'none') state.warnings.add('forecast_unavailable');
  if (ctx.weather.reliability === 'low') state.warnings.add('forecast_unreliable');

  const slots = chooseSlots(
    format,
    duration,
    request.food ?? 'auto',
    request.budgetEur,
    ctx.random,
  );
  const items: PlanItem[] = [];
  for (const [index, slot] of slots.entries()) {
    const kept = request.keep?.[index];
    const item =
      (kept && schedule(slot, kept.activity, kept.place, state, request, ctx)) ||
      (await fillSlot(slot, state, request, ctx, format));
    if (item) {
      items.push(item);
      apply(item, state, request, ctx);
    }
  }

  const food = request.food ?? 'auto';
  if ((food === 'meal' || food === 'snack') && !items.some((i) => i.slot === food)) {
    state.warnings.add('food_skipped');
  }

  if (items.length === 0) {
    const fallback = schedule('main', FALLBACK_ACTIVITY, null, state, request, ctx) ?? {
      slot: 'main' as const,
      activity: FALLBACK_ACTIVITY,
      place: null,
      travelBefore: null,
      start: request.start,
      end: request.end,
      costEur: estimatedCost(FALLBACK_ACTIVITY),
      openingHoursUnknown: false,
    };
    items.push(fallback);
    apply(fallback, state, request, ctx);
    state.warnings.add('fallback_used');
  }

  const home = travelHome(state.location, request, ctx);
  return {
    format,
    items,
    travelHome: home,
    totalCostEur: items.reduce((sum, i) => sum + i.costEur, 0) + (home?.costEur ?? 0),
    weather: ctx.weather,
    warnings: [...state.warnings],
    placeLookups: state.lookups,
  };
}
