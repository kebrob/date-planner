import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getGeocoder, getPlaceDetailsProvider, getRail, getWeatherProvider } from '@/adapters';
import type { RatingValue } from '@/core/planner/learning';
import type { PlanWarning, Transport } from '@/core/planner/types';
import { summarizeWeather, weatherConcern, windowWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { activity, datePlan, planItem, settings, suggestionLog, travelRoutine } from '@/db/schema';
import { addMinutes, fromLocal, minutesBetween, toLocalDate, toLocalTime } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import {
  generatePlan,
  homePoint,
  savedInput,
  type ChosenStopInput,
  type PlanInput,
} from './service';
import { REAL_TIMES_HORIZON_HOURS } from '@/rail/expected';
import { attachTrains, hasOpenTrainLegs, type TrainPlan } from './trains';
import { toPlanView, trainUrl, type Leg, type PlanView } from './view';

export class PlanNotFoundError extends Error {}
export class PlanNotEditableError extends Error {}
/** Nothing fitted into the gap a stop was added to. */
export class StopNotAddedError extends Error {}

type ItemRow = typeof planItem.$inferSelect;
type PlanRow = typeof datePlan.$inferSelect;

/** Stored place data: either a full place or the minimal reference kept after the date. */
type StoredPlace =
  Place | { provider: Place['provider']; id: string; name: string; archived: true };

export function isFullPlace(value: unknown): value is Place {
  return typeof value === 'object' && value !== null && 'location' in value;
}

/**
 * Google terms restrict long-term storage of place content; after the date only id and name are
 * kept. OpenStreetMap data (ODbL) may be stored as is.
 */
export function archivedPlace(place: Place): StoredPlace {
  if (place.provider !== 'google') return place;
  return { provider: place.provider, id: place.id, name: place.name, archived: true };
}

export type Window = { date: string; startTime: string; endDate: string; endTime: string };

export type WeatherConcern = NonNullable<ReturnType<typeof weatherConcern>>;

export type SavedPlanView = PlanView & {
  id: string;
  isFavorite: boolean;
  note: string | null;
  isPast: boolean;
  transport: PlanInput['transport'];
  /** The date has started, so it can be rated. */
  canRate: boolean;
  rating: RatingValue | null;
  notHappened: boolean;
  itemRatings: { rating: RatingValue | null; placeBlamed: boolean }[];
  /** Per item, for upcoming plans: why the forecast may not suit it any more. */
  weatherConcerns: (WeatherConcern | null)[];
  window: Window;
};

export type PlanSummary = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  titles: string[];
  totalCostEur: number;
  isFavorite: boolean;
  areaName: string | null;
  rating: RatingValue | null;
  notHappened: boolean;
};

const idSchema = z.string().uuid();
// Built-in fallbacks and one-off stops (chat, place search) are not stored ideas.
const storedIdea = (id: string) => idSchema.safeParse(id).success;

function windowOf(plan: Pick<PlanRow, 'startsAt' | 'endsAt'>, input: Partial<PlanInput>): Window {
  return {
    date: input.date ?? toLocalDate(plan.startsAt),
    startTime: input.startTime ?? toLocalTime(plan.startsAt),
    endDate: input.endDate ?? toLocalDate(plan.endsAt),
    endTime: input.endTime ?? toLocalTime(plan.endsAt),
  };
}

/** Input the plan was created with, without per-request re-roll state. */
function baseInput(plan: PlanRow): PlanInput {
  return savedInput(plan.parameters as PlanInput);
}

function stripLeg(leg: Leg | null): Leg | null {
  return leg ? { ...leg, directionsUrl: null } : null;
}

export async function archiveExpiredPlaces(now = new Date()): Promise<void> {
  const db = getDb();
  const expired = await db
    .select({ id: planItem.id, place: planItem.place, travel: planItem.travel })
    .from(planItem)
    .innerJoin(datePlan, eq(planItem.planId, datePlan.id))
    .where(
      and(
        lt(datePlan.endsAt, now),
        sql`${planItem.place}->>'provider' = 'google'`,
        sql`${planItem.place} ? 'location'`,
      ),
    );
  for (const row of expired) {
    if (!isFullPlace(row.place)) continue;
    await db
      .update(planItem)
      .set({
        place: archivedPlace(row.place),
        alternatives: [],
        travel: stripLeg(row.travel as Leg | null),
      })
      .where(eq(planItem.id, row.id));
  }
  // Route links embed coordinates of the previous stop, so they go for every leg of past plans.
  const past = db.select({ id: datePlan.id }).from(datePlan).where(lt(datePlan.endsAt, now));
  await db
    .update(planItem)
    .set({ travel: sql`${planItem.travel} - 'directionsUrl'` })
    .where(and(inArray(planItem.planId, past), sql`${planItem.travel} ? 'directionsUrl'`));
  await db
    .update(datePlan)
    .set({ travelHome: sql`${datePlan.travelHome} - 'directionsUrl'` })
    .where(and(lt(datePlan.endsAt, now), sql`${datePlan.travelHome} ? 'directionsUrl'`));
}

function itemValues(planId: string, view: PlanView) {
  return view.items.map((item, position) => ({
    planId,
    position,
    activityId: storedIdea(item.activityId) ? item.activityId : null,
    startsAt: new Date(item.start),
    endsAt: new Date(item.end),
    title: item.title,
    slot: item.slot,
    preparation: item.preparation,
    atHome: item.atHome,
    openingHoursUnknown: item.openingHoursUnknown,
    placeProvider: item.place?.provider ?? null,
    placeId: item.place?.id ?? null,
    placeName: item.place?.name ?? item.placeName,
    place: item.place,
    alternatives: item.alternatives,
    costEur: item.costEur,
    travel: item.travelBefore,
  }));
}

// Coarse enough not to count as stored place data, fine enough for the weather.
const roundTo10Km = (p: LatLng) => ({
  lat: Math.round(p.lat * 10) / 10,
  lng: Math.round(p.lng * 10) / 10,
});

function planValues(view: PlanView, input: PlanInput) {
  const firstPlace = view.items.find((i) => i.place)?.place?.location;
  return {
    weatherPoint: firstPlace ? roundTo10Km(firstPlace) : null,
    // Changed plans may have new train legs to look up.
    trainsCheckedAt: null,
    startsAt: new Date(view.items[0]!.start),
    endsAt: new Date(view.items.at(-1)!.end),
    parameters: input,
    weather: view.weather,
    totalCostEur: view.totalCostEur,
    overBudgetEur: view.overBudgetEur,
    areaName: view.area,
    travelHome: view.travelHome,
    updatedAt: new Date(),
  };
}

export async function savePlan(input: PlanInput, view: PlanView): Promise<string> {
  if (view.items.length === 0) throw new Error('Cannot save an empty plan');
  return getDb().transaction(async (tx) => {
    const [plan] = await tx
      .insert(datePlan)
      .values({ ...planValues(view, input), status: 'accepted' })
      .returning({ id: datePlan.id });
    if (!plan) throw new Error('Plan insert failed');
    await tx.insert(planItem).values(itemValues(plan.id, view));
    // Accepted activities count stronger for variety than mere suggestions.
    const ids = view.items.map((i) => i.activityId).filter(storedIdea);
    const known = ids.length
      ? await tx.select({ id: activity.id }).from(activity).where(inArray(activity.id, ids))
      : [];
    if (known.length > 0) {
      await tx
        .insert(suggestionLog)
        .values(known.map((a) => ({ activityId: a.id, planId: plan.id, accepted: true })));
    }
    return plan.id;
  });
}

async function replacePlan(id: string, input: PlanInput, view: PlanView) {
  await getDb().transaction(async (tx) => {
    await tx.update(datePlan).set(planValues(view, input)).where(eq(datePlan.id, id));
    await tx.delete(planItem).where(eq(planItem.planId, id));
    await tx.insert(planItem).values(itemValues(id, view));
  });
}

export async function listPlans(now = new Date()) {
  await archiveExpiredPlaces(now);
  const db = getDb();
  const plans = await db
    .select()
    .from(datePlan)
    .where(eq(datePlan.status, 'accepted'))
    .orderBy(asc(datePlan.startsAt));
  const items = plans.length
    ? await db
        .select({ planId: planItem.planId, title: planItem.title })
        .from(planItem)
        .where(
          inArray(
            planItem.planId,
            plans.map((p) => p.id),
          ),
        )
        .orderBy(asc(planItem.position))
    : [];
  const summaries: (PlanSummary & { isPast: boolean })[] = plans.map((p) => ({
    id: p.id,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    titles: items.filter((i) => i.planId === p.id).map((i) => i.title),
    totalCostEur: p.totalCostEur,
    isFavorite: p.isFavorite,
    areaName: p.areaName,
    rating: p.rating,
    notHappened: p.notHappened,
    isPast: p.endsAt < now,
  }));
  return {
    upcoming: summaries.filter((p) => !p.isPast),
    past: summaries.filter((p) => p.isPast).reverse(),
    favourites: summaries.filter((p) => p.isFavorite),
  };
}

export async function listUpcoming(now = new Date()): Promise<PlanSummary[]> {
  const db = getDb();
  const plans = await db
    .select()
    .from(datePlan)
    .where(and(eq(datePlan.status, 'accepted'), gte(datePlan.endsAt, now)))
    .orderBy(asc(datePlan.startsAt))
    .limit(5);
  if (plans.length === 0) return [];
  const items = await db
    .select({ planId: planItem.planId, title: planItem.title })
    .from(planItem)
    .where(
      inArray(
        planItem.planId,
        plans.map((p) => p.id),
      ),
    )
    .orderBy(asc(planItem.position));
  return plans.map((p) => ({
    id: p.id,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    titles: items.filter((i) => i.planId === p.id).map((i) => i.title),
    totalCostEur: p.totalCostEur,
    isFavorite: p.isFavorite,
    areaName: p.areaName,
    rating: p.rating,
    notHappened: p.notHappened,
  }));
}

async function loadPlan(id: string): Promise<{ plan: PlanRow; items: ItemRow[] }> {
  if (!idSchema.safeParse(id).success) throw new PlanNotFoundError();
  const db = getDb();
  const [plan] = await db.select().from(datePlan).where(eq(datePlan.id, id)).limit(1);
  if (!plan || plan.status !== 'accepted') throw new PlanNotFoundError();
  const items = await db
    .select()
    .from(planItem)
    .where(eq(planItem.planId, id))
    .orderBy(asc(planItem.position));
  return { plan, items };
}

export function rowsToView(plan: PlanRow, items: ItemRow[], now: Date): SavedPlanView {
  return {
    id: plan.id,
    isFavorite: plan.isFavorite,
    note: plan.note,
    isPast: plan.endsAt < now,
    canRate: plan.startsAt <= now,
    rating: plan.rating,
    notHappened: plan.notHappened,
    itemRatings: items.map((i) => ({ rating: i.rating, placeBlamed: i.placeBlamed })),
    weatherConcerns: items.map(() => null),
    window: windowOf(plan, plan.parameters as PlanInput),
    transport: (plan.parameters as PlanInput).transport,
    format: (items.length <= 1
      ? 'single'
      : items.length === 2
        ? 'evening'
        : 'day') as PlanView['format'],
    area: plan.areaName,
    items: items.map((i) => ({
      slot: i.slot as PlanView['items'][number]['slot'],
      activityId: i.activityId ?? `builtin-${i.id}`,
      title: i.title,
      description: '',
      preparation: i.preparation,
      atHome: i.atHome,
      place: isFullPlace(i.place) ? i.place : null,
      placeName: i.placeName,
      locationHint: null,
      alternatives: (i.alternatives as Place[]) ?? [],
      travelBefore: (i.travel as Leg | null) ?? null,
      start: i.startsAt.toISOString(),
      end: i.endsAt.toISOString(),
      costEur: i.costEur,
      openingHoursUnknown: i.openingHoursUnknown,
    })),
    travelHome: (plan.travelHome as Leg | null) ?? null,
    totalCostEur: plan.totalCostEur,
    overBudgetEur: plan.overBudgetEur,
    weather: (plan.weather as PlanView['weather']) ?? {
      reliability: 'none',
      dry: null,
      minTempC: null,
      maxTempC: null,
    },
    warnings: [],
  };
}

// Saved plans look for better trains at most this often (free API, but rate-limited).
const TRAIN_CHECK_INTERVAL_MS = 6 * 3_600_000;

/**
 * Gives saved upcoming plans real trains once their date is within the timetable horizon, and
 * expected trains before. Returns warnings to show, or null when nothing was checked.
 */
async function refreshTrains(
  plan: PlanRow,
  items: ItemRow[],
  now: Date,
): Promise<PlanWarning[] | null> {
  if (plan.endsAt < now) return null;
  if (
    plan.trainsCheckedAt &&
    now.getTime() - plan.trainsCheckedAt.getTime() < TRAIN_CHECK_INTERVAL_MS
  ) {
    return null;
  }
  const rail = getRail();
  if (!rail) return null;
  const trainPlan: TrainPlan = {
    items: items.map((i) => ({
      activity: { atHome: i.atHome },
      place: isFullPlace(i.place) ? i.place : null,
      travelBefore: (i.travel as Leg | null) ?? null,
      start: i.startsAt,
      end: i.endsAt,
    })),
    travelHome: (plan.travelHome as Leg | null) ?? null,
    warnings: [],
  };
  if (!hasOpenTrainLegs(trainPlan)) return null;
  // Expected trains cannot get better until the date is within the timetable horizon.
  const legs = [...trainPlan.items.map((i) => i.travelBefore), trainPlan.travelHome];
  const beyondHorizon =
    plan.startsAt.getTime() - now.getTime() > REAL_TIMES_HORIZON_HOURS * 3_600_000;
  if (beyondHorizon && legs.every((l) => l?.mode !== 'train' || l.train)) return null;

  const db = getDb();
  const input = plan.parameters as PlanInput;
  const [[home], routines] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)).limit(1),
    db.select().from(travelRoutine),
  ]);
  if (!home) return null;
  const window = windowOf(plan, input);
  const routine = routines.find((r) => r.transport === input.transport);
  const area =
    input.startInArea && input.areaPoint
      ? { lat: input.areaPoint.lat, lng: input.areaPoint.lng }
      : input.startInArea && input.area
        ? ((
            await getGeocoder()
              .find(input.area)
              .catch(() => null)
          )?.location ?? undefined)
        : undefined;
  await attachTrains(
    trainPlan,
    {
      start: fromLocal(window.date, window.startTime),
      end: fromLocal(window.endDate, window.endTime),
      transport: input.transport as Transport,
      home: homePoint(home),
      homeGrid: { lat: home.homeLat, lng: home.homeLng },
      startPoint: area,
      routine: routine && {
        transport: routine.transport as Transport,
        firstLegMinutes: routine.firstLegMinutes,
        bufferMinutes: routine.bufferMinutes,
      },
      refreshOnly: true,
      now,
    },
    rail,
  ).catch(() => {
    trainPlan.warnings.push('trains_unavailable');
  });

  const withUrl = (leg: Leg | null): Leg | null =>
    leg?.train ? { ...leg, trainUrl: trainUrl(leg.train, leg.transfers) } : leg;
  const written = await db.transaction(async (tx) => {
    // Optimistic lock: an edit saved while trains were looked up wins (Postgres keeps
    // microseconds, the loaded value only milliseconds).
    const [current] = await tx
      .update(datePlan)
      .set({
        travelHome: withUrl(trainPlan.travelHome as Leg | null),
        startsAt: trainPlan.items[0]?.start ?? plan.startsAt,
        endsAt: trainPlan.items.at(-1)?.end ?? plan.endsAt,
        // After a failed lookup, try again on the next view instead of hours later.
        trainsCheckedAt: trainPlan.warnings.includes('trains_unavailable')
          ? plan.trainsCheckedAt
          : now,
      })
      .where(
        and(
          eq(datePlan.id, plan.id),
          sql`date_trunc('milliseconds', ${datePlan.updatedAt}) = ${plan.updatedAt}`,
        ),
      )
      .returning({ id: datePlan.id });
    if (!current) return false;
    for (const [index, item] of items.entries()) {
      const updated = trainPlan.items[index]!;
      await tx
        .update(planItem)
        .set({
          travel: withUrl(updated.travelBefore as Leg | null),
          startsAt: updated.start,
          endsAt: updated.end,
        })
        .where(eq(planItem.id, item.id));
    }
    return true;
  });
  if (!written) return null;
  return trainPlan.warnings;
}

/** Looks up trains for dates starting soon, so the live card has them without opening the plan. */
export async function refreshSoonTrains(now: Date, withinHours: number): Promise<void> {
  const db = getDb();
  const plans = await db
    .select()
    .from(datePlan)
    .where(
      and(
        eq(datePlan.status, 'accepted'),
        gte(datePlan.endsAt, now),
        lt(datePlan.startsAt, new Date(now.getTime() + withinHours * 3_600_000)),
      ),
    )
    .limit(3);
  for (const plan of plans) {
    const items = await db
      .select()
      .from(planItem)
      .where(eq(planItem.planId, plan.id))
      .orderBy(asc(planItem.position));
    await refreshTrains(plan, items, now).catch(() => null);
  }
}

export async function getSavedPlan(id: string, now = new Date()): Promise<SavedPlanView> {
  await archiveExpiredPlaces(now);
  let { plan, items } = await loadPlan(id);
  const trainWarnings = await refreshTrains(plan, items, now).catch(() => null);
  if (trainWarnings) ({ plan, items } = await loadPlan(id));
  const view = rowsToView(plan, items, now);
  view.warnings = trainWarnings ?? [];
  if (!view.isPast) {
    // Weather is free, so refresh it on every view.
    const db = getDb();
    const [home] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    const firstPlace = view.items.find((i) => i.place)?.place?.location;
    const location = firstPlace ?? (home ? { lat: home.homeLat, lng: home.homeLng } : null);
    if (location) {
      const hours = await getWeatherProvider()
        .hourly(location, plan.startsAt, plan.endsAt)
        .catch(() => []);
      if (hours.length > 0) {
        view.weather = summarizeWeather(hours, plan.startsAt, plan.endsAt, now);
        const ids = items.flatMap((i) => (i.activityId ? [i.activityId] : []));
        const activities = ids.length
          ? await db
              .select({
                id: activity.id,
                tags: activity.tags,
                weather: activity.weather,
                atHome: activity.atHome,
              })
              .from(activity)
              .where(inArray(activity.id, ids))
          : [];
        view.weatherConcerns = items.map((item) => {
          const a = activities.find((x) => x.id === item.activityId);
          return a
            ? weatherConcern(
                a,
                windowWeather(hours, item.startsAt, item.endsAt, view.weather.reliability),
              )
            : null;
        });
      }
    }
  }
  return view;
}

export async function updatePlanMeta(
  id: string,
  changes: { isFavorite?: boolean; note?: string | null },
): Promise<void> {
  await loadPlan(id);
  await getDb()
    .update(datePlan)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(datePlan.id, id));
}

export async function deletePlan(id: string): Promise<void> {
  await loadPlan(id);
  await getDb().delete(datePlan).where(eq(datePlan.id, id));
}

export type PlanEdit =
  | { type: 'reroll'; index: number }
  | { type: 'remove'; index: number }
  | { type: 'swap'; index: number; placeId: string }
  /** New date/time and, optionally, a new transport; stops and venues stay where possible. */
  | { type: 'reschedule'; window: Window; transport?: PlanInput['transport'] }
  /** `keep`: other stops stay, times move; `around`: re-plan the rest around the chosen stop. */
  | { type: 'replace'; index: number; stop: ChosenStopInput; mode: 'keep' | 'around' }
  /** New stop before the item at `position` (or at the end); `stop` null = planner's pick. */
  | { type: 'add'; position: number; stop: ChosenStopInput | null };

type KeepEntry = {
  activityId: string;
  place: Place | null;
  alternatives: Place[];
  /** Stays at this start ("HH:MM"). */
  startTime?: string;
};

function keepOf(item: ItemRow): KeepEntry | null {
  if (!item.activityId) return null;
  if (item.placeId && !isFullPlace(item.place)) return null;
  return {
    activityId: item.activityId,
    place: isFullPlace(item.place) ? item.place : null,
    alternatives: (item.alternatives as Place[]) ?? [],
  };
}

/**
 * One-off stops (no stored idea, but a venue) cannot be kept like ideas; they are re-pinned from
 * the saved item so that editing other stops does not lose them.
 */
export function oneOffStop(item: ItemRow, index: number): ChosenStopInput | null {
  if (item.activityId || !isFullPlace(item.place)) return null;
  const slot = item.slot as 'main' | 'meal' | 'snack';
  return {
    activityId: null,
    custom: {
      title: item.title,
      kind: slot === 'main' ? 'activity' : slot,
      durationMinutes: Math.max(15, minutesBetween(item.startsAt, item.endsAt)),
      costEur: item.costEur,
      query: item.placeName ?? item.title,
    },
    place: item.place,
    startTime: null,
    index,
  };
}

function keepRecord(entries: (KeepEntry | null)[]) {
  return Object.fromEntries(
    entries.flatMap((e, i) => (e ? [[String(i), e] as const] : [])),
  ) as NonNullable<PlanInput['keep']>;
}

async function homeLocation() {
  const [home] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!home) throw new Error('Settings missing');
  return homePoint(home);
}

/** Re-plans a saved, upcoming plan; returns the titles of kept stops that no longer fit. */
export async function editPlan(id: string, edit: PlanEdit, now = new Date()): Promise<string[]> {
  const { plan, items } = await loadPlan(id);
  if (plan.endsAt < now) throw new PlanNotEditableError();
  const base = baseInput(plan);
  if (edit.type === 'add') return addStop(id, plan, items, base, edit.position, edit.stop);
  if (edit.type !== 'reschedule' && !items[edit.index]) throw new PlanNotEditableError();
  // A re-rolled, removed or replaced stop that was chosen for a set time is no longer fixed.
  if (edit.type !== 'reschedule' && edit.type !== 'swap') {
    const target = items[edit.index]!;
    base.chosen = base.chosen?.filter(
      (c) =>
        (c.activityId ?? null) !== target.activityId ||
        (!c.activityId && c.custom?.title !== target.title),
    );
    if (base.chosen?.length === 0) delete base.chosen;
  }

  let rows = items;
  let entries = items.map(keepOf);
  let window = windowOf(plan, base);
  const exclude: string[] = [];
  let chosen: ChosenStopInput[] | undefined;
  // Moving a plan leaves stops out that no longer fit instead of suggesting others.
  let leaveOut = false;

  switch (edit.type) {
    case 'reroll': {
      const target = items[edit.index]!;
      if (target.activityId) exclude.push(target.activityId);
      entries[edit.index] = null;
      break;
    }
    case 'remove': {
      if (items.length <= 1) throw new PlanNotEditableError();
      const removed = items[edit.index]!;
      if (removed.activityId) exclude.push(removed.activityId);
      rows = items.filter((_, i) => i !== edit.index);
      entries = rows.map(keepOf);
      // The user wants less: free time stays free, now and in later edits.
      base.fillGaps = false;
      break;
    }
    case 'swap': {
      const entry = entries[edit.index];
      const alternative = entry?.alternatives.find((p) => p.id === edit.placeId);
      if (!entry || !alternative) throw new PlanNotEditableError();
      entries[edit.index] = {
        ...entry,
        place: alternative,
        alternatives: [
          ...(entry.place ? [entry.place] : []),
          ...entry.alternatives.filter((p) => p.id !== edit.placeId),
        ],
      };
      break;
    }
    case 'reschedule': {
      window = edit.window;
      if (edit.transport) base.transport = edit.transport;
      // Stops keep their time of day where the new window allows it; extra time stays free.
      const start = fromLocal(window.date, window.startTime);
      const end = fromLocal(window.endDate, window.endTime);
      items.forEach((item, i) => {
        const entry = entries[i];
        if (!entry) return;
        const time = toLocalTime(item.startsAt);
        const sameDay = fromLocal(window.date, time);
        const at = sameDay < start ? fromLocal(window.endDate, time) : sameDay;
        const minutes = minutesBetween(item.startsAt, item.endsAt);
        if (at >= start && addMinutes(at, minutes) <= end)
          entries[i] = { ...entry, startTime: time };
      });
      base.fillGaps = false;
      leaveOut = true;
      break;
    }
    case 'replace':
      if (edit.mode === 'around') {
        // Only the chosen stop is fixed, at the time the replaced one started.
        const input: PlanInput = {
          ...base,
          ...window,
          chosen: [
            ...(base.chosen ?? []),
            { ...edit.stop, startTime: toLocalTime(items[edit.index]!.startsAt), index: null },
          ],
          excludeActivityIds: [],
        };
        const result = await generatePlan(input);
        const view = toPlanView(result.plan, await homeLocation(), result.area);
        await replacePlan(id, savedInput(input), view);
        return [];
      }
      entries[edit.index] = null;
      chosen = [{ ...edit.stop, startTime: null, index: edit.index }];
      break;
  }

  // Fixed one-off stops come back through the saved input; only the others are re-pinned.
  const fixedTitles = new Set(
    (base.chosen ?? []).flatMap((c) => (c.custom ? [c.custom.title] : [])),
  );
  const oneOffs = rows.flatMap((row, i) => {
    const stop =
      entries[i] || chosen?.some((c) => c.index === i) || fixedTitles.has(row.title)
        ? null
        : oneOffStop(row, i);
    const rerolled = edit.type === 'reroll' && i === edit.index;
    return stop && !rerolled ? [stop] : [];
  });
  const input: PlanInput = {
    ...base,
    ...window,
    slots: rows.map((r) => r.slot as 'main' | 'meal' | 'snack'),
    keep: keepRecord(entries),
    chosen: [...(base.chosen ?? []), ...(chosen ?? []), ...oneOffs],
    excludeActivityIds: exclude,
    replaceUnfit: leaveOut ? false : undefined,
  };
  const result = await generatePlan(input);
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  await replacePlan(id, savedInput(input), view);
  return unfitTitles(rows, entries, view);
}

/** Kept stops that could not stay as they were (e.g. no time left, venue closed then). */
function unfitTitles(rows: ItemRow[], entries: (KeepEntry | null)[], view: PlanView): string[] {
  return rows.flatMap((row, i) => {
    const e = entries[i];
    const stays = view.items.some(
      (item) => item.activityId === e?.activityId && item.place?.id === e?.place?.id,
    );
    return e && !stays ? [row.title] : [];
  });
}

// Same cap as the planner's.
const MAX_STOPS = 5;

/**
 * Adds a stop at a position: the stops stay, the one after the gap keeps its start so the new
 * one fills the gap. Throws when nothing fits there.
 */
async function addStop(
  id: string,
  plan: PlanRow,
  items: ItemRow[],
  base: PlanInput,
  position: number,
  stop: ChosenStopInput | null,
): Promise<string[]> {
  if (position < 0 || position > items.length || items.length >= MAX_STOPS) {
    throw new PlanNotEditableError();
  }
  const entries = items.map(keepOf);
  const fixedTitles = new Set(
    (base.chosen ?? []).flatMap((c) => (c.custom ? [c.custom.title] : [])),
  );
  const shift = (i: number) => (i >= position ? i + 1 : i);
  const oneOffs = items.flatMap((row, i) => {
    const pinned = entries[i] || fixedTitles.has(row.title) ? null : oneOffStop(row, shift(i));
    return pinned ? [pinned] : [];
  });
  entries.splice(position, 0, null);
  const keep = keepRecord(entries);
  const next = keep[String(position + 1)];
  if (next) next.startTime = toLocalTime(items[position]!.startsAt);
  const slots = items.map((r) => r.slot as 'main' | 'meal' | 'snack');
  slots.splice(position, 0, 'main');

  const input: PlanInput = {
    ...base,
    ...windowOf(plan, base),
    slots,
    keep,
    anyKindAt: stop ? undefined : [position],
    chosen: [
      ...(base.chosen ?? []),
      ...(stop ? [{ ...stop, startTime: null, index: position }] : []),
      ...oneOffs,
    ],
    excludeActivityIds: [],
  };
  const result = await generatePlan(input);
  if (result.plan.items.length <= items.length) throw new StopNotAddedError();
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  await replacePlan(id, savedInput(input), view);
  return unfitTitles(items, items.map(keepOf), view);
}

/** Creates a new upcoming plan from an existing one (e.g. a favourite) for another date. */
export async function planAgain(id: string, window: Window): Promise<string> {
  const { plan, items } = await loadPlan(id);
  const details = getPlaceDetailsProvider();
  const entries: (KeepEntry | null)[] = [];
  for (const item of items) {
    let entry = keepOf(item);
    if (!entry && item.activityId && item.placeProvider === 'google' && item.placeId && details) {
      // Archived Google place: re-fetch its data (one guarded lookup).
      const place = await details.details(item.placeId).catch(() => null);
      if (place) entry = { activityId: item.activityId, place, alternatives: [] };
    }
    entries.push(entry);
  }
  const fixed = baseInput(plan).chosen ?? [];
  const fixedTitles = new Set(fixed.flatMap((c) => (c.custom ? [c.custom.title] : [])));
  const input: PlanInput = {
    ...baseInput(plan),
    ...window,
    slots: items.map((r) => r.slot as 'main' | 'meal' | 'snack'),
    keep: keepRecord(entries),
    chosen: [
      ...fixed,
      ...items.flatMap((item, i) =>
        entries[i] || fixedTitles.has(item.title) ? [] : (oneOffStop(item, i) ?? []),
      ),
    ],
    excludeActivityIds: [],
  };
  const result = await generatePlan(input);
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  return savePlan({ ...baseInput(plan), ...window }, view);
}
