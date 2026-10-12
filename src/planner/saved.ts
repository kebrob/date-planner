import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RatingValue } from '@/core/planner/learning';
import { weatherConcern } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { loadSettings } from '@/db/settings';
import { activity, datePlan, planItem, suggestionLog } from '@/db/schema';
import { toLocalDate, toLocalTime } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { planViewSchema } from './schemas';
import { homePoint, planInputSchema, savedInput, type PlanInput } from './service';
import type { Leg, PlanView } from './view';

export class PlanNotFoundError extends Error {}

export type ItemRow = typeof planItem.$inferSelect;
export type PlanRow = typeof datePlan.$inferSelect;

export function isFullPlace(value: unknown): value is Place {
  return typeof value === 'object' && value !== null && 'location' in value;
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
export const storedIdea = (id: string) => idSchema.safeParse(id).success;

export function windowOf(
  plan: Pick<PlanRow, 'startsAt' | 'endsAt'>,
  input: Partial<PlanInput>,
): Window {
  return {
    date: input.date ?? toLocalDate(plan.startsAt),
    startTime: input.startTime ?? toLocalTime(plan.startsAt),
    endDate: input.endDate ?? toLocalDate(plan.endsAt),
    endTime: input.endTime ?? toLocalTime(plan.endsAt),
  };
}

/** Input the plan was created with, without per-request re-roll state. */
export function baseInput(plan: PlanRow): PlanInput {
  return savedInput(plan.parameters as PlanInput);
}

/**
 * Google terms restrict long-term storage of place content; after the date only provider, id and
 * name are kept. OpenStreetMap data (ODbL) may be stored as is. Route links embed coordinates of
 * the previous stop, so they go for every leg of past plans.
 */
export async function archiveExpiredPlaces(now = new Date()): Promise<void> {
  const db = getDb();
  const past = db.select({ id: datePlan.id }).from(datePlan).where(lt(datePlan.endsAt, now));
  await db
    .update(planItem)
    .set({
      place: sql`jsonb_build_object('provider', ${planItem.place}->'provider', 'id', ${planItem.place}->'id', 'name', ${planItem.place}->'name', 'archived', true)`,
      alternatives: [],
    })
    .where(
      and(
        inArray(planItem.planId, past),
        sql`${planItem.place}->>'provider' = 'google'`,
        sql`${planItem.place} ? 'location'`,
      ),
    );
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

/** `view` usually comes from the client, so it is validated before it is stored. */
export async function savePlan(input: PlanInput, rawView: PlanView): Promise<string> {
  planInputSchema.parse(input);
  const view = planViewSchema.parse(rawView);
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

export async function replacePlan(id: string, input: PlanInput, view: PlanView) {
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

export async function loadPlan(id: string): Promise<{ plan: PlanRow; items: ItemRow[] }> {
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

export async function homeLocation() {
  return homePoint(await loadSettings());
}
