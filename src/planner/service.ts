import { desc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getGeocoder, getPlacesProvider, getWeatherProvider } from '@/adapters';
import { getLimits } from '@/config/limits';
import { buildPlan } from '@/core/planner/build-plan';
import type { Activity, History, Plan, PlanRequest, Transport } from '@/core/planner/types';
import { summarizeWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import {
  activity,
  datePlan,
  planItem,
  settings,
  suggestionLog,
  tagWeight,
  travelRoutine,
} from '@/db/schema';
import { fromLocal } from '@/lib/time';
import type { GeoArea } from '@/ports/geocoding';
import type { Place } from '@/ports/places';

export class AreaNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`Area not found: ${query}`);
  }
}

const transport = z.enum(['deutschlandticket', 'car', 'walk', 'bike']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

const placeSchema = z.object({
  provider: z.enum(['google', 'osm']),
  id: z.string().max(300),
  name: z.string().max(300),
  location: z.object({ lat: z.number(), lng: z.number() }),
  address: z.string().max(500).optional(),
  rating: z.number().optional(),
  openingHours: z
    .union([
      z.object({ alwaysOpen: z.literal(true) }),
      z.object({
        alwaysOpen: z.literal(false),
        periods: z.array(z.object({ start: z.number(), end: z.number() })).max(50),
      }),
    ])
    .nullable(),
  mapsUrl: z.string().max(500).optional(),
});

export const planInputSchema = z
  .object({
    date,
    startTime: time,
    endDate: date,
    endTime: time,
    budgetEur: z.number().int().min(0).max(2000),
    transport,
    preferences: z.array(z.string().max(30)).max(10),
    format: z.enum(['single', 'evening', 'day']).optional(),
    food: z.enum(['auto', 'none', 'snack', 'meal']).default('auto'),
    area: z.string().trim().max(100).optional(),
    excludeActivityIds: z.array(z.string().max(100)).max(100).default([]),
    keep: z
      .record(z.string(), z.object({ activityId: z.string(), place: placeSchema.nullable() }))
      .optional(),
  })
  .refine((v) => fromLocal(v.date, v.startTime) < fromLocal(v.endDate, v.endTime), {
    message: 'End must be after start',
  })
  .refine(
    (v) =>
      fromLocal(v.endDate, v.endTime).getTime() - fromLocal(v.date, v.startTime).getTime() <=
      24 * 3_600_000,
    { message: 'Plans are limited to 24 hours' },
  );

export type PlanInput = z.input<typeof planInputSchema>;

type ActivityRow = typeof activity.$inferSelect;

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: row.tags,
    costMinEur: row.costMinEur,
    costMaxEur: row.costMaxEur,
    durationMinutes: row.durationMinutes,
    weather: row.weather,
    transports: row.transports,
    atHome: row.atHome,
    placeType: row.placeType,
    placeQuery: row.placeQuery,
    timesOfDay: row.timesOfDay as Activity['timesOfDay'],
    seasons: row.seasons as Activity['seasons'],
    preparation: row.preparation,
  };
}

async function loadHistory(now: Date): Promise<History> {
  const rows = await getDb()
    .select({
      activityId: suggestionLog.activityId,
      lastSuggested: max(suggestionLog.createdAt),
      lastAccepted: sql<Date | null>`max(${suggestionLog.createdAt}) filter (where ${suggestionLog.accepted})`,
    })
    .from(suggestionLog)
    .groupBy(suggestionLog.activityId);
  const days = (d: Date | string | null) =>
    d ? (now.getTime() - new Date(d).getTime()) / 86_400_000 : undefined;
  const history: History = { daysSinceSuggested: {}, daysSinceAccepted: {} };
  for (const r of rows) {
    const s = days(r.lastSuggested);
    const a = days(r.lastAccepted);
    if (s !== undefined) history.daysSinceSuggested[r.activityId] = s;
    if (a !== undefined) history.daysSinceAccepted[r.activityId] = a;
  }
  return history;
}

export async function loadPlannerDefaults() {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!row) throw new Error('Settings missing – run npm run db:seed');
  return {
    transport: row.defaultTransport as Transport,
    budgetEur: row.defaultBudgetEur,
    homeName: row.homeName,
  };
}

export async function generatePlan(
  rawInput: PlanInput,
): Promise<{ plan: Plan; input: z.output<typeof planInputSchema>; area: GeoArea | null }> {
  const input = planInputSchema.parse(rawInput);
  const db = getDb();
  const now = new Date();
  const start = fromLocal(input.date, input.startTime);
  const end = fromLocal(input.endDate, input.endTime);

  const [[home], routines, activityRows, weights, history] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)).limit(1),
    db.select().from(travelRoutine),
    db.select().from(activity).where(eq(activity.status, 'active')),
    db.select().from(tagWeight).where(eq(tagWeight.context, 'any')),
    loadHistory(now),
  ]);
  if (!home) throw new Error('Settings missing – run npm run db:seed');

  const activities = activityRows.map(toActivity);
  const homeLocation = { lat: home.homeLat, lng: home.homeLng };
  const area = input.area ? await getGeocoder().find(input.area) : null;
  if (input.area && !area) throw new AreaNotFoundError(input.area);
  const weatherHours = await getWeatherProvider()
    .hourly(area?.location ?? homeLocation, start, end)
    .catch(() => []);

  const keep: PlanRequest['keep'] = {};
  for (const [index, k] of Object.entries(input.keep ?? {})) {
    const kept = activities.find((a) => a.id === k.activityId);
    if (kept) keep[Number(index)] = { activity: kept, place: k.place as Place | null };
  }

  const places = getPlacesProvider();
  const plan = await buildPlan(
    {
      start,
      end,
      budgetEur: input.budgetEur,
      transport: input.transport,
      preferences: input.preferences,
      format: input.format,
      food: input.food,
      area,
      excludeActivityIds: input.excludeActivityIds,
      keep,
    },
    {
      home: homeLocation,
      maxRadiusKm: home.maxRadiusKm,
      routines: routines.map((r) => ({
        transport: r.transport as Transport,
        firstLegMinutes: r.firstLegMinutes,
        bufferMinutes: r.bufferMinutes,
      })),
      activities,
      history,
      weather: summarizeWeather(weatherHours, start, end, now),
      tagWeights: Object.fromEntries(weights.map((w) => [w.tag, w.weight])),
      maxPlaceLookups: getLimits().places.maxLookupsPerPlan,
      findPlaces: (a, center, radiusKm) =>
        places.search({
          placeType: a.placeType ?? '',
          query: a.placeQuery ?? a.title,
          center,
          radiusKm,
          maxResults: 10,
        }),
      random: Math.random,
    },
  );

  const suggested = plan.items
    .map((i) => i.activity.id)
    .filter((id) => activities.some((a) => a.id === id));
  if (suggested.length > 0) {
    await db.insert(suggestionLog).values(suggested.map((activityId) => ({ activityId })));
  }
  return { plan, input, area };
}

export const acceptSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  parameters: z.record(z.string(), z.unknown()),
  weather: z.unknown(),
  totalCostEur: z.number().int().min(0),
  items: z
    .array(
      z.object({
        activityId: z.string(),
        title: z.string().max(200),
        start: z.string().datetime(),
        end: z.string().datetime(),
        costEur: z.number().int().min(0),
        place: placeSchema.nullable(),
        travel: z.unknown(),
      }),
    )
    .min(1)
    .max(4),
});

export async function acceptPlan(raw: z.input<typeof acceptSchema>): Promise<string> {
  const input = acceptSchema.parse(raw);
  const db = getDb();
  const known = new Set((await db.select({ id: activity.id }).from(activity)).map((r) => r.id));
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(datePlan)
      .values({
        startsAt: new Date(input.start),
        endsAt: new Date(input.end),
        parameters: input.parameters,
        weather: input.weather ?? null,
        totalCostEur: input.totalCostEur,
        status: 'accepted',
      })
      .returning({ id: datePlan.id });
    if (!plan) throw new Error('Plan insert failed');
    await tx.insert(planItem).values(
      input.items.map((item, position) => ({
        planId: plan.id,
        position,
        activityId: known.has(item.activityId) ? item.activityId : null,
        startsAt: new Date(item.start),
        endsAt: new Date(item.end),
        title: item.title,
        placeProvider: item.place?.provider ?? null,
        placeId: item.place?.id ?? null,
        placeName: item.place?.name ?? null,
        costEur: item.costEur,
        travel: item.travel ?? null,
      })),
    );
    const accepted = input.items.filter((i) => known.has(i.activityId));
    if (accepted.length > 0) {
      await tx
        .insert(suggestionLog)
        .values(
          accepted.map((i) => ({ activityId: i.activityId, planId: plan.id, accepted: true })),
        );
    }
    return plan.id;
  });
}

export async function listPlans(limit = 20) {
  const db = getDb();
  const plans = await db
    .select()
    .from(datePlan)
    .where(eq(datePlan.status, 'accepted'))
    .orderBy(desc(datePlan.startsAt))
    .limit(limit);
  const items = plans.length
    ? await db
        .select()
        .from(planItem)
        .where(
          inArray(
            planItem.planId,
            plans.map((p) => p.id),
          ),
        )
        .orderBy(planItem.position)
    : [];
  return plans.map((p) => ({ ...p, items: items.filter((i) => i.planId === p.id) }));
}
