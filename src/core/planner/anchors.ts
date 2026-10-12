import { addMinutes, minutesBetween } from '@/lib/time';
import type { LatLng } from '@/ports/places';
import { isOpenDuring } from './opening-hours';
import { searchRegion } from './region';
import { foodKind, itemCost, needsPlace } from './rules';
import { travelTo, type State } from './state';
import type { ChosenStop, PlanContext, PlanItem, PlanRequest, Slot } from './types';
import { closestFirst, venuesFor } from './venues';
import { MAX_ITEMS } from './types';

export type Anchor = ChosenStop & { start: Date; location: LatLng; slot: Slot };
type Entry = { slot: Slot; anchor?: Anchor };

// A chosen stop that starts this much later than wanted is flagged.
const ANCHOR_TOLERANCE_MIN = 5;

/** Finds the venue of each fixed-time stop up front, so earlier items can head towards it. */
export async function resolveAnchors(
  request: PlanRequest,
  state: State,
  ctx: PlanContext,
): Promise<Anchor[]> {
  const anchors: Anchor[] = [];
  const sorted = [...(request.anchors ?? [])].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const chosen of sorted) {
    const { activity } = chosen;
    const slot = foodKind(activity) ?? 'main';
    let place = chosen.place;
    if (!place && needsPlace(activity)) {
      const region = searchRegion(state, request, ctx);
      const end = addMinutes(chosen.start, activity.durationMinutes);
      const open = (await venuesFor(activity, region, state, request, ctx))?.filter(
        (p) => !p.openingHours || isOpenDuring(p.openingHours, chosen.start, end),
      );
      // A fixed block sets the course of the day, so the closest venue wins (no random pick).
      place = closestFirst(open ?? [], region.anchors)[0] ?? null;
      if (!place) {
        state.warnings.add('required_skipped');
        continue;
      }
    }
    const location = activity.atHome
      ? ctx.home
      : (place?.location ?? request.area?.location ?? state.location);
    anchors.push({ ...chosen, place, location, slot });
  }
  return anchors;
}

/**
 * Puts fixed-time stops between the planned slots by time of day; each takes the place of a
 * planned slot of its kind (a fixed dinner replaces the planned meal).
 */
export function withAnchors(slots: Slot[], anchors: Anchor[], request: PlanRequest): Entry[] {
  if (request.keep) return anchorsIntoLayout(slots, anchors, request);
  const rest = [...slots];
  for (const anchor of anchors) {
    const same = rest.indexOf(anchor.slot);
    if (same !== -1) rest.splice(same, 1);
  }
  const duration = minutesBetween(request.start, request.end);
  const entries: Entry[] = [];
  let used = 0;
  for (const anchor of anchors) {
    const share = minutesBetween(request.start, anchor.start) / duration;
    const before = Math.max(used, Math.min(rest.length, Math.round(share * rest.length)));
    entries.push(...rest.slice(used, before).map((slot) => ({ slot })), {
      slot: anchor.slot,
      anchor,
    });
    used = before;
  }
  entries.push(...rest.slice(used).map((slot) => ({ slot })));
  return entries;
}

/**
 * With kept stops the layout is that of an existing plan, which already has a slot for each fixed
 * stop; moving slots around would shift the kept indices. Each fixed stop takes the free slot (not
 * kept, not pinned) of its kind closest to its time of day, so it never displaces a kept stop.
 */
function anchorsIntoLayout(slots: Slot[], anchors: Anchor[], request: PlanRequest): Entry[] {
  const entries: Entry[] = slots.map((slot) => ({ slot }));
  const duration = minutesBetween(request.start, request.end);
  const isFree = (i: number) => !entries[i]!.anchor && !request.keep?.[i] && !request.pins?.[i];
  let after = -1;
  for (const anchor of anchors) {
    const wanted = (minutesBetween(request.start, anchor.start) / duration) * (slots.length - 1);
    const closest = (matches: (i: number) => boolean) =>
      entries
        .map((_, i) => i)
        .filter((i) => i > after && isFree(i) && matches(i))
        .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0];
    const index =
      closest((i) => entries[i]!.slot === anchor.slot) ?? closest(() => true) ?? entries.length;
    entries[index] = { slot: anchor.slot, anchor };
    after = index;
  }
  return entries;
}

/**
 * At most `MAX_ITEMS` entries. Open slots go first (latest first), then kept or pinned ones; a
 * fixed-time stop is only cut when nothing else is left, and then flagged.
 */
export function trimmed(entries: Entry[], request: PlanRequest, state: State): Entry[] {
  const result = [...entries];
  const open = (e: Entry, i: number) => !e.anchor && !request.keep?.[i] && !request.pins?.[i];
  while (result.length > MAX_ITEMS) {
    let cut = result.findLastIndex(open);
    if (cut === -1) cut = result.findLastIndex((e) => !e.anchor);
    if (cut === -1) {
      cut = result.length - 1;
      state.warnings.add('required_skipped');
    }
    result.splice(cut, 1);
  }
  return result;
}

/** A fixed-time stop: waits for its start if early, starts on arrival (flagged) if late. */
export function scheduleAnchor(
  anchor: Anchor,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
): PlanItem {
  const travel = travelTo(anchor.location, state, request, ctx);
  const arrival = addMinutes(state.cursor, travel?.minutes ?? 0);
  if (minutesBetween(anchor.start, arrival) > ANCHOR_TOLERANCE_MIN) {
    state.warnings.add('chosen_time_moved');
  }
  const start = arrival > anchor.start ? arrival : anchor.start;
  const end = addMinutes(start, anchor.activity.durationMinutes);
  return {
    slot: anchor.slot,
    activity: anchor.activity,
    place: anchor.place,
    travelBefore: travel,
    start,
    end,
    costEur: itemCost(anchor.activity, anchor.place) + (travel?.costEur ?? 0),
    openingHoursUnknown: anchor.place !== null && anchor.place.openingHours === null,
    alternatives: [],
  };
}
