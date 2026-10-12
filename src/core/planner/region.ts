import { minutesBetween } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { distanceKm, maxDistanceKm, reachKm } from './geo';
import { endsInArea, type State } from './state';
import type { PlanContext, PlanRequest, Transport } from './types';

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

export type Region = {
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
export function searchRegion(state: State, request: PlanRequest, ctx: PlanContext): Region {
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

  const goal =
    state.nextStop?.location ?? area ?? (endsInArea(request) ? request.area!.location : ctx.home);
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
export function probeFor(region: Region, state: State): Place {
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
