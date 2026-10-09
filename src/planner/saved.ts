import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getPlaceDetailsProvider, getWeatherProvider } from '@/adapters';
import { summarizeWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { activity, datePlan, planItem, settings, suggestionLog } from '@/db/schema';
import { toLocalDate, toLocalTime } from '@/lib/time';
import type { Place } from '@/ports/places';
import { generatePlan, homePoint, type PlanInput } from './service';
import { toPlanView, type Leg, type PlanView } from './view';

export class PlanNotFoundError extends Error {}
export class PlanNotEditableError extends Error {}

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

export type SavedPlanView = PlanView & {
  id: string;
  isFavorite: boolean;
  note: string | null;
  isPast: boolean;
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
};

const idSchema = z.string().uuid();

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
  const input = { ...(plan.parameters as PlanInput) };
  delete input.keep;
  delete input.slots;
  return { ...input, excludeActivityIds: [] };
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
    activityId: item.activityId.startsWith('builtin-') ? null : item.activityId,
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

function planValues(view: PlanView, input: PlanInput) {
  return {
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
    const ids = view.items.map((i) => i.activityId).filter((id) => !id.startsWith('builtin-'));
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
    window: windowOf(plan, plan.parameters as PlanInput),
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

export async function getSavedPlan(id: string, now = new Date()): Promise<SavedPlanView> {
  await archiveExpiredPlaces(now);
  const { plan, items } = await loadPlan(id);
  const view = rowsToView(plan, items, now);
  if (!view.isPast) {
    // Weather is free, so refresh it on every view.
    const [home] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
    const firstPlace = view.items.find((i) => i.place)?.place?.location;
    const location = firstPlace ?? (home ? { lat: home.homeLat, lng: home.homeLng } : null);
    if (location) {
      const hours = await getWeatherProvider()
        .hourly(location, plan.startsAt, plan.endsAt)
        .catch(() => []);
      if (hours.length > 0) view.weather = summarizeWeather(hours, plan.startsAt, plan.endsAt, now);
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
  | { type: 'reschedule'; window: Window };

type KeepEntry = { activityId: string; place: Place | null; alternatives: Place[] };

function keepOf(item: ItemRow): KeepEntry | null {
  if (!item.activityId) return null;
  if (item.placeId && !isFullPlace(item.place)) return null;
  return {
    activityId: item.activityId,
    place: isFullPlace(item.place) ? item.place : null,
    alternatives: (item.alternatives as Place[]) ?? [],
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

/** Re-plans a saved, upcoming plan; returns how many items had to be dropped. */
export async function editPlan(id: string, edit: PlanEdit, now = new Date()): Promise<number> {
  const { plan, items } = await loadPlan(id);
  if (plan.endsAt < now) throw new PlanNotEditableError();
  const base = baseInput(plan);
  if (edit.type !== 'reschedule' && !items[edit.index]) throw new PlanNotEditableError();

  let rows = items;
  let entries = items.map(keepOf);
  let window = windowOf(plan, base);
  const exclude: string[] = [];

  switch (edit.type) {
    case 'reroll': {
      const target = items[edit.index]!;
      if (target.activityId) exclude.push(target.activityId);
      entries[edit.index] = null;
      break;
    }
    case 'remove':
      if (items.length <= 1) throw new PlanNotEditableError();
      rows = items.filter((_, i) => i !== edit.index);
      entries = rows.map(keepOf);
      break;
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
    case 'reschedule':
      window = edit.window;
      break;
  }

  const input: PlanInput = {
    ...base,
    ...window,
    slots: rows.map((r) => r.slot as 'main' | 'meal' | 'snack'),
    keep: keepRecord(entries),
    excludeActivityIds: exclude,
  };
  const result = await generatePlan(input);
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  await replacePlan(id, { ...base, ...window }, view);
  // Kept items that could not stay as they were (e.g. venue closed on the new date).
  return entries.filter(
    (e) =>
      e && !view.items.some((i) => i.activityId === e.activityId && i.place?.id === e.place?.id),
  ).length;
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
  const input: PlanInput = {
    ...baseInput(plan),
    ...window,
    slots: items.map((r) => r.slot as 'main' | 'meal' | 'snack'),
    keep: keepRecord(entries),
    excludeActivityIds: [],
  };
  const result = await generatePlan(input);
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  return savePlan({ ...baseInput(plan), ...window }, view);
}
