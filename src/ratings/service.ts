import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { getWeatherProvider } from '@/adapters';
import { learn, shouldSuggestBlock, type RatedItem } from '@/core/planner/learning';
import type { Learning, WeatherCondition } from '@/core/planner/types';
import { windowWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { activity, datePlan, planItem, settings, suggestionLog } from '@/db/schema';

export const ratingSchema = z.enum(['dislike', 'like', 'love']).nullable();
export type Rating = z.infer<typeof ratingSchema>;

export class PlanNotRatableError extends Error {}

// Past dates are offered for rating on the home screen for this long.
const PROMPT_DAYS = 14;
const idSchema = z.string().uuid();

/** Rated items of dates that took place, with what is needed to learn from them. */
export async function loadRatedItems(now = new Date()): Promise<RatedItem[]> {
  const rows = await getDb()
    .select({
      activityId: planItem.activityId,
      tags: activity.tags,
      placeProvider: planItem.placeProvider,
      placeId: planItem.placeId,
      itemRating: planItem.rating,
      planRating: datePlan.rating,
      placeBlamed: planItem.placeBlamed,
      conditions: planItem.weatherConditions,
      endsAt: datePlan.endsAt,
    })
    .from(planItem)
    .innerJoin(datePlan, eq(planItem.planId, datePlan.id))
    .innerJoin(activity, eq(planItem.activityId, activity.id))
    .where(
      and(
        eq(datePlan.status, 'accepted'),
        eq(datePlan.notHappened, false),
        or(isNotNull(datePlan.rating), isNotNull(planItem.rating)),
      ),
    );
  return rows.map((r) => ({
    activityId: r.activityId!,
    tags: r.tags,
    place: r.placeProvider && r.placeId ? `${r.placeProvider}:${r.placeId}` : null,
    itemRating: r.itemRating,
    planRating: r.planRating,
    placeBlamed: r.placeBlamed,
    conditions: (r.conditions ?? []) as WeatherCondition[],
    ageDays: (now.getTime() - r.endsAt.getTime()) / 86_400_000,
  }));
}

export async function loadLearning(now = new Date()): Promise<Learning> {
  return learn(await loadRatedItems(now));
}

async function ratablePlan(planId: string, now: Date) {
  if (!idSchema.safeParse(planId).success) throw new PlanNotRatableError();
  const [plan] = await getDb().select().from(datePlan).where(eq(datePlan.id, planId)).limit(1);
  if (!plan || plan.status !== 'accepted' || plan.startsAt > now) throw new PlanNotRatableError();
  return plan;
}

/**
 * Stores the weather each item actually had, so ratings can be learned per weather condition.
 * Best effort: on failure the conditions stay unknown and are retried with the next rating.
 */
async function recordWeather(plan: typeof datePlan.$inferSelect): Promise<void> {
  const db = getDb();
  const items = await db
    .select({ id: planItem.id, startsAt: planItem.startsAt, endsAt: planItem.endsAt })
    .from(planItem)
    .where(and(eq(planItem.planId, plan.id), isNull(planItem.weatherConditions)));
  if (items.length === 0) return;
  let point = plan.weatherPoint;
  if (!point) {
    const [home] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (!home) return;
    point = { lat: home.homeLat, lng: home.homeLng };
  }
  const hours = await getWeatherProvider()
    .hourly(point, plan.startsAt, plan.endsAt)
    .catch(() => []);
  if (hours.length === 0) return;
  for (const item of items) {
    const weather = windowWeather(hours, item.startsAt, item.endsAt, 'good');
    await db
      .update(planItem)
      .set({ weatherConditions: weather.conditions ?? [] })
      .where(eq(planItem.id, item.id));
  }
}

export async function rateDate(planId: string, rating: Rating, now = new Date()): Promise<void> {
  const plan = await ratablePlan(planId, now);
  await getDb().update(datePlan).set({ rating, updatedAt: now }).where(eq(datePlan.id, planId));
  if (rating) await recordWeather(plan);
}

/** Rates one item; returns whether the idea has been disliked often enough to suggest blocking. */
export async function rateItem(
  planId: string,
  position: number,
  rating: Rating,
  placeBlamed: boolean,
  now = new Date(),
): Promise<{ suggestBlock: boolean; activityId: string | null }> {
  const plan = await ratablePlan(planId, now);
  const db = getDb();
  const [item] = await db
    .select({ id: planItem.id, activityId: planItem.activityId, placeId: planItem.placeId })
    .from(planItem)
    .where(and(eq(planItem.planId, planId), eq(planItem.position, position)))
    .limit(1);
  if (!item) throw new PlanNotRatableError();
  const blamed = rating === 'dislike' && placeBlamed && item.placeId !== null;
  await db.update(planItem).set({ rating, placeBlamed: blamed }).where(eq(planItem.id, item.id));
  if (rating) await recordWeather(plan);
  if (rating !== 'dislike' || blamed || !item.activityId) {
    return { suggestBlock: false, activityId: item.activityId };
  }
  const [current] = await db
    .select({ status: activity.status })
    .from(activity)
    .where(eq(activity.id, item.activityId))
    .limit(1);
  return {
    suggestBlock:
      current?.status === 'active' &&
      shouldSuggestBlock(await loadRatedItems(now), item.activityId),
    activityId: item.activityId,
  };
}

/** "We didn't go": the date no longer counts for variety or learning. Reversible. */
export async function setNotHappened(
  planId: string,
  notHappened: boolean,
  now = new Date(),
): Promise<void> {
  await ratablePlan(planId, now);
  await getDb().transaction(async (tx) => {
    await tx.update(datePlan).set({ notHappened, updatedAt: now }).where(eq(datePlan.id, planId));
    await tx
      .update(suggestionLog)
      .set({ accepted: !notHappened })
      .where(eq(suggestionLog.planId, planId));
  });
}

export async function dismissRatingPrompt(planId: string, now = new Date()): Promise<void> {
  await ratablePlan(planId, now);
  await getDb()
    .update(datePlan)
    .set({ ratingPromptDismissed: true })
    .where(eq(datePlan.id, planId));
}

export type RatingPrompt = { id: string; startsAt: Date; titles: string[] };

/** Recent past dates without a rating that were neither skipped nor marked as not happened. */
export async function listRatingPrompts(now = new Date(), limit = 2): Promise<RatingPrompt[]> {
  const db = getDb();
  const plans = await db
    .select({ id: datePlan.id, startsAt: datePlan.startsAt })
    .from(datePlan)
    .where(
      and(
        eq(datePlan.status, 'accepted'),
        lt(datePlan.endsAt, now),
        gte(datePlan.endsAt, new Date(now.getTime() - PROMPT_DAYS * 86_400_000)),
        isNull(datePlan.rating),
        eq(datePlan.notHappened, false),
        eq(datePlan.ratingPromptDismissed, false),
      ),
    )
    .orderBy(desc(datePlan.endsAt))
    .limit(limit);
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
    titles: items.filter((i) => i.planId === p.id).map((i) => i.title),
  }));
}
