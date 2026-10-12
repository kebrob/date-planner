import type { LatLng, Place } from '@/ports/places';
import { distanceKm, estimateTravel } from './geo';
import type {
  Activity,
  PlanContext,
  PlanRequest,
  PlanWarning,
  Travel,
  WeatherSummary,
} from './types';
import { windowWeather } from './weather';

export type State = {
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
  /** The next chosen stop at a fixed time; items before it must end in time to get there. */
  nextStop: { location: LatLng; at: Date } | null;
};

function routineFor(ctx: PlanContext, request: PlanRequest) {
  return ctx.routines.find((r) => r.transport === request.transport);
}

export function travelTo(
  target: LatLng,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
): Travel | null {
  if (distanceKm(state.location, target) < 0.05) return null;
  const routine = state.atHomeLocation ? routineFor(ctx, request) : undefined;
  return estimateTravel(state.location, target, request.transport, routine);
}

export const startsInArea = (request: PlanRequest) => Boolean(request.area && request.startInArea);
export const endsInArea = (request: PlanRequest) => Boolean(request.area && request.endInArea);

export function travelHome(
  location: LatLng,
  request: PlanRequest,
  ctx: PlanContext,
): Travel | null {
  if (endsInArea(request) || distanceKm(location, ctx.home) < 0.05) return null;
  return estimateTravel(location, ctx.home, request.transport, routineFor(ctx, request));
}

/** Weather during [start, end]; the whole-window summary when there is no hourly forecast. */
export function weatherAt(ctx: PlanContext, start: Date, end: Date): WeatherSummary {
  return ctx.forecast.length > 0
    ? windowWeather(ctx.forecast, start, end, ctx.weather.reliability)
    : ctx.weather;
}

/** Location of an item: home, its venue, or – for venue-less outdoor ideas – where we are. */
export function targetOf(
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
