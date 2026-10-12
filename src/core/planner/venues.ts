import type { LatLng, Place } from '@/ports/places';
import { distanceKm, maxDistanceKm } from './geo';
import { weightedShuffle } from './random';
import type { Region } from './region';
import { isFreeSearch } from './rules';
import { startsInArea, type State } from './state';
import type { Activity, PlanContext, PlanRequest } from './types';

// Places rated as the problem of a past date stay possible, but only as a last resort.
const AVOIDED_PLACE_FACTOR = 0.02;

export function rankPlaces(places: Place[], anchors: LatLng[], radiusKm: number, ctx: PlanContext) {
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

export function closestFirst(places: Place[], anchors: LatLng[]): Place[] {
  const distance = (p: Place) => Math.min(...anchors.map((a) => distanceKm(a, p.location)));
  return [...places].sort((a, b) => distance(a) - distance(b));
}

export function lookupsLeft(activity: Activity, state: State, ctx: PlanContext): boolean {
  const paidLeft = state.lookups < ctx.maxPlaceLookups;
  return isFreeSearch(activity)
    ? state.freeLookups < ctx.maxFreePlaceLookups && (!state.freeFallsBack || paidLeft)
    : paidLeft;
}

export const MAX_ALTERNATIVES = 2;

/**
 * Venues for an idea in the region, reachable with the transport; null when no search is allowed
 * (limit reached or `worthSearching` says no). Results are cached per plan.
 */
export async function venuesFor(
  activity: Activity,
  region: Region,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
  worthSearching: () => boolean = () => true,
): Promise<Place[] | null> {
  const picked = request.chosenPlaces?.[activity.id];
  if (picked) return [picked];
  const cacheKey = `${activity.id}|${region.center.lat},${region.center.lng}|${region.radiusKm}`;
  let places = state.placeCache.get(cacheKey);
  if (!places) {
    if (!worthSearching()) return null;
    if (!lookupsLeft(activity, state, ctx)) {
      state.warnings.add('place_lookup_limit_reached');
      return null;
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
  const range = maxDistanceKm(request.transport);
  // Already in the area: walking or cycling range counts from there, not from home.
  const origin = startsInArea(request) ? request.area!.location : ctx.home;
  return places.filter(
    (p) =>
      region.accepts(p.location) && (range === Infinity || distanceKm(origin, p.location) <= range),
  );
}
