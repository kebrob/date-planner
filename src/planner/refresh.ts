import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getGeocoder, getRail, getWeatherProvider } from '@/adapters';
import type { PlanWarning, Transport } from '@/core/planner/types';
import { summarizeWeather, weatherConcern, windowWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { findSettings } from '@/db/settings';
import { activity, datePlan, planItem, travelRoutine } from '@/db/schema';
import { fromLocal } from '@/lib/time';
import { REAL_TIMES_HORIZON_HOURS } from '@/rail/expected';
import {
  archiveExpiredPlaces,
  isFullPlace,
  loadPlan,
  rowsToView,
  windowOf,
  type ItemRow,
  type PlanRow,
  type SavedPlanView,
} from './saved';
import { homePoint, toRoutine, type PlanInput } from './service';
import { attachTrains, hasOpenTrainLegs, type TrainPlan } from './trains';
import { trainUrl, type Leg } from './view';

// Saved plans look for better trains at most this often (free API, but rate-limited).
const TRAIN_CHECK_INTERVAL_MS = 6 * 3_600_000;
// After a failed lookup (rate limit, outage); the live card polls every minute.
const TRAIN_RETRY_MS = 20 * 60_000;

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
  const [home, routines] = await Promise.all([findSettings(), db.select().from(travelRoutine)]);
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
      routine: routine && toRoutine(routine),
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
        // After a failed lookup, try again soon instead of hours later.
        trainsCheckedAt: trainPlan.warnings.includes('trains_unavailable')
          ? new Date(now.getTime() - TRAIN_CHECK_INTERVAL_MS + TRAIN_RETRY_MS)
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
    const home = await findSettings();
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
