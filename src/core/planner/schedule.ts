import { sunsetAt } from '@/lib/sun';
import { addMinutes, minutesBetween } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { estimateTravel } from './geo';
import { isOpenDuring } from './opening-hours';
import { itemCost } from './rules';
import { targetOf, travelHome, travelTo, type State } from './state';
import type { Activity, PlanContext, PlanItem, PlanRequest, Slot } from './types';

// Kept back for later slots so the first item cannot use up the whole budget.
const SLOT_RESERVE_EUR: Record<Slot, number> = { main: 0, meal: 25, snack: 8 };
// Likewise time, including a short way between stops.
const SLOT_RESERVE_MIN: Record<Slot, number> = { main: 75, meal: 90, snack: 40 };
const STRETCH_FACTOR = 1.5;

export type Pass = {
  /** Max cost of this item including travel there and back home. */
  limitEur: number;
  /** Extra items after the planned slots: prefer free ideas, stay out (no going home mid-trip). */
  filler: boolean;
  /** Going home is only allowed for the last planned item, never in the middle of an outing. */
  homeAllowed: boolean;
  /** Minutes kept free for the remaining planned slots. */
  reserveMinutes: number;
};

export function makePass(
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
    homeAllowed: state.atHomeLocation || (!filler && laterSlots.length === 0 && !state.nextStop),
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

export function schedule(
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
  // Before a chosen stop at a fixed time, the item must leave enough time to get there.
  const next = state.nextStop;
  const back = next
    ? estimateTravel(target, next.location, request.transport, undefined)
    : travelHome(target, request, ctx);
  const deadline = next ? next.at : request.end;
  if (addMinutes(end, (back?.minutes ?? 0) + pass.reserveMinutes) > deadline) return null;

  const costEur = itemCost(activity, place) + (travel?.costEur ?? 0);
  if (costEur + (next ? 0 : (back?.costEur ?? 0)) > pass.limitEur) return null;

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

// Chosen stops are what the user wants, so only time and opening hours can rule them out.
export const CHOSEN_PASS: Pass = {
  limitEur: Infinity,
  filler: false,
  homeAllowed: true,
  reserveMinutes: 0,
};
