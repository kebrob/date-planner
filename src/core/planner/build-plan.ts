import { addMinutes, minutesBetween } from '@/lib/time';
import type { Place } from '@/ports/places';
import { distanceKm, estimateTravel, maxDistanceKm } from './geo';
import { weightedShuffle } from './random';
import {
  chooseSlots,
  estimatedCost,
  fitsWeather,
  foodKind,
  formatFor,
  isCandidate,
  needsPlace,
  score,
} from './rules';
import type { Activity, ChosenStop, Plan, PlanContext, PlanItem, PlanRequest, Slot } from './types';
import { weatherFactor } from './weather';
import { resolveAnchors, scheduleAnchor, trimmed, withAnchors, type Anchor } from './anchors';
import { autoAreaRadiusKm, probeFor, searchRegion } from './region';
import { CHOSEN_PASS, makePass, schedule, type Pass } from './schedule';
import { endsInArea, startsInArea, targetOf, travelHome, weatherAt, type State } from './state';
import { closestFirst, lookupsLeft, MAX_ALTERNATIVES, rankPlaces, venuesFor } from './venues';
import { MAX_ITEMS } from './types';
export { autoAreaRadiusKm, autoRadiusKm, firstStopRadiusKm } from './region';

const MAX_CANDIDATES_PER_SLOT = 15;
// Free time left (before heading home) that is worth filling with another item.
const MIN_FILL_MINUTES = 90;

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

/** Schedules a chosen stop at the current position: its own venue or the best one nearby. */
async function placeChosen(
  slot: Slot,
  chosen: ChosenStop,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
): Promise<PlanItem | null> {
  const { activity, place } = chosen;
  if (place || !needsPlace(activity)) {
    return schedule(slot, activity, place, state, request, ctx, CHOSEN_PASS);
  }
  const region = searchRegion(state, request, ctx);
  const venues = await venuesFor(activity, region, state, request, ctx);
  // The user asked for this idea, so the closest fitting venue wins (no random pick).
  const ranked = closestFirst(venues ?? [], region.anchors);
  for (const venue of ranked) {
    const item = schedule(slot, activity, venue, state, request, ctx, CHOSEN_PASS);
    if (!item) continue;
    item.alternatives = ranked
      .filter((p) => p !== venue && schedule(slot, activity, p, state, request, ctx, CHOSEN_PASS))
      .slice(0, MAX_ALTERNATIVES);
    return item;
  }
  return null;
}

async function fillSlot(
  slot: Slot,
  state: State,
  request: PlanRequest,
  ctx: PlanContext,
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
      !state.reserved.has(a.id) &&
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
    // Don't spend a lookup on an idea that can't fit even at the closest point of the region.
    const fitsSomewhere = () =>
      Boolean(schedule(slot, activity, probeFor(region, state), state, request, ctx, pass));
    const reachable = await venuesFor(activity, region, state, request, ctx, fitsSomewhere);
    if (!reachable) continue;
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
  filler = false,
): Promise<PlanItem | null> {
  const normal = await fillSlot(
    slot,
    state,
    request,
    ctx,
    makePass(state, request, laterSlots, false, filler),
  );
  if (normal) return normal;
  const stretch = request.allowOverBudget ?? false;
  const stretched =
    stretch &&
    (await fillSlot(slot, state, request, ctx, makePass(state, request, laterSlots, true, filler)));
  if (stretched || laterSlots.length === 0) return stretched || null;
  // Nothing fits while keeping time and money for later slots: rather plan this one alone.
  return fillSlot(slot, state, request, ctx, makePass(state, request, [], stretch, filler));
}

function freeMinutes(state: State, request: PlanRequest, ctx: PlanContext): number {
  const next = state.nextStop;
  if (next) {
    const way = estimateTravel(state.location, next.location, request.transport, undefined);
    return minutesBetween(state.cursor, next.at) - way.minutes;
  }
  const home = travelHome(state.location, request, ctx);
  return minutesBetween(state.cursor, request.end) - (home?.minutes ?? 0);
}

function apply(item: PlanItem, state: State, request: PlanRequest, ctx: PlanContext) {
  const target = targetOf(item.activity, item.place, state, request, ctx);
  state.cursor = item.end;
  state.spentEur += item.costEur;
  state.used.add(item.activity.id);
  state.reserved.delete(item.activity.id);
  state.atHomeLocation = distanceKm(target, ctx.home) < 0.05;
  state.location = target;
  if (
    request.area &&
    distanceKm(target, request.area.location) <=
      (request.maxDistanceKm ?? autoAreaRadiusKm(request.transport))
  ) {
    state.reachedArea = true;
  }
  if (item.openingHoursUnknown) state.warnings.add('opening_hours_unknown');
}

/**
 * Builds a schedule for the request. All loops are bounded: at most `MAX_ITEMS` items, 15 candidates
 * per slot and attempt, and `maxPlaceLookups` + `maxFreePlaceLookups` place searches in total.
 */
export async function buildPlan(planRequest: PlanRequest, ctx: PlanContext): Promise<Plan> {
  // Already in a town out of walking or cycling range of home: they got there some other way, so
  // the way back is not part of the date and it is planned like staying there.
  const homeOutOfReach =
    startsInArea(planRequest) &&
    !endsInArea(planRequest) &&
    distanceKm(planRequest.area!.location, ctx.home) > maxDistanceKm(planRequest.transport);
  const request = homeOutOfReach ? { ...planRequest, endInArea: true } : planRequest;
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
    reserved: new Set(
      [
        ...Object.values(request.keep ?? {}),
        ...Object.values(request.pins ?? {}),
        ...(request.anchors ?? []),
      ].map((stop) => stop.activity.id),
    ),
    lookups: 0,
    freeLookups: 0,
    freeFallsBack: false,
    placeCache: new Map(),
    warnings: new Set(),
    nextStop: null,
  };
  if (ctx.weather.reliability === 'none') state.warnings.add('forecast_unavailable');
  if (ctx.weather.reliability === 'low') state.warnings.add('forecast_unreliable');
  if (homeOutOfReach) state.warnings.add('way_home_not_planned');

  const anchors = await resolveAnchors(request, state, ctx);
  const slots = withRequiredSlots(
    request.slots ??
      chooseSlots(format, duration, request.food ?? 'auto', request.budgetEur, ctx.random),
    request.required ?? [],
  );
  const entries = trimmed(withAnchors(slots, anchors, request), request, state);
  const items: PlanItem[] = [];
  const add = (item: PlanItem) => {
    items.push(item);
    apply(item, state, request, ctx);
  };
  // Fixed stops still to come must keep their place within MAX_ITEMS.
  let anchorsLeft = entries.filter((e) => e.anchor).length;
  /** Long gaps (before a fixed stop or the way home): extra items, preferring free ideas nearby. */
  const fillGap = async () => {
    while (
      request.fillGaps !== false &&
      (items.length > 0 || state.nextStop) &&
      items.length + anchorsLeft < MAX_ITEMS &&
      freeMinutes(state, request, ctx) >= MIN_FILL_MINUTES
    ) {
      const item = await fillWithStretch('main', [], state, request, ctx, true);
      if (!item) break;
      add(item);
    }
  };

  /** A fixed block at this position: a chosen stop at a set time, or a kept one that was. */
  const fixedAt = (index: number): Anchor | undefined => {
    const entry = entries[index];
    if (entry?.anchor) return entry.anchor;
    const kept = request.keep?.[index];
    if (!entry || !kept?.at) return undefined;
    return {
      activity: kept.activity,
      place: kept.place,
      start: kept.at,
      slot: entry.slot,
      location: targetOf(kept.activity, kept.place, state, request, ctx),
    };
  };
  anchorsLeft += entries.filter((e, i) => !e.anchor && fixedAt(i)).length;

  for (const [index, entry] of entries.entries()) {
    let nextAnchor = -1;
    for (let i = index; i < entries.length && nextAnchor === -1; i++) {
      if (fixedAt(i)) nextAnchor = i;
    }
    const anchor = nextAnchor === -1 ? undefined : fixedAt(nextAnchor)!;
    state.nextStop = anchor ? { location: anchor.location, at: anchor.start } : null;

    if (nextAnchor === index && anchor) {
      await fillGap();
      const item = scheduleAnchor(anchor, state, request, ctx);
      // Only a kept stop brings its alternatives; a chosen one may sit at another stop's index.
      item.alternatives = entries[index]?.anchor ? [] : (request.keep?.[index]?.alternatives ?? []);
      add(item);
      anchorsLeft--;
      continue;
    }

    // Time and money are only kept back for slots before the next fixed stop.
    const later = entries
      .slice(index + 1, nextAnchor === -1 ? undefined : nextAnchor)
      .map((e) => e.slot);
    const kept = request.keep?.[index];
    const keepPass = (laterSlots: Slot[]) =>
      makePass(state, request, laterSlots, request.allowOverBudget ?? false);
    // A stop the user already has is kept even without room held back for later slots.
    const keptItem =
      kept &&
      (schedule(entry.slot, kept.activity, kept.place, state, request, ctx, keepPass(later)) ||
        schedule(entry.slot, kept.activity, kept.place, state, request, ctx, keepPass([])));
    if (keptItem) keptItem.alternatives = kept.alternatives ?? [];
    const pinned = request.pins?.[index];
    const pinnedItem =
      !keptItem && pinned ? await placeChosen(entry.slot, pinned, state, request, ctx) : null;
    if (pinned && !pinnedItem) state.warnings.add('required_skipped');
    const leaveOut = kept && !keptItem && request.replaceUnfit === false;
    let item =
      keptItem ||
      pinnedItem ||
      (leaveOut ? null : await fillWithStretch(entry.slot, later, state, request, ctx));
    if (!item && !pinned && request.anyKindAt?.includes(index)) {
      for (const kind of ['snack', 'meal'] as const) {
        item = await fillWithStretch(kind, later, state, request, ctx);
        if (item) break;
      }
    }
    if (item) add(item);
  }

  state.nextStop = null;
  await fillGap();

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
