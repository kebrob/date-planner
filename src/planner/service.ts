import { and, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getGeocoder, getPlacesProvider, getRail, getWeatherProvider } from '@/adapters';
import { getLimits } from '@/config/limits';
import { buildPlan } from '@/core/planner/build-plan';
import {
  CUISINES,
  type Activity,
  type History,
  type Plan,
  type PlanRequest,
  type Transport,
} from '@/core/planner/types';
import { summarizeWeather } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { activity, apiUsage, settings, suggestionLog, tagWeight, travelRoutine } from '@/db/schema';
import { dayKey } from '@/guard/periods';
import { nextOuting } from './outing';
import { attachTrains } from './trains';
import { fitsWeather, seasonOf, timeOfDay } from '@/core/planner/rules';
import { fromLocal } from '@/lib/time';
import type { GeoArea } from '@/ports/geocoding';
import type { LatLng, Place } from '@/ports/places';

export class AreaNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`Area not found: ${query}`);
  }
}

const transport = z.enum(['deutschlandticket', 'car', 'walk', 'bike']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

export const placeSchema = z.object({
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
    cuisine: z.enum(CUISINES).nullable().optional(),
    area: z.string().trim().max(100).optional(),
    /** Centre picked on the map; takes precedence over `area`. */
    areaPoint: z
      .object({
        name: z.string().trim().min(1).max(100),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),
    maxDistanceKm: z.number().int().min(1).max(300).nullable().optional(),
    /** With a chosen area: already there at the start / staying there afterwards. */
    startInArea: z.boolean().optional(),
    endInArea: z.boolean().optional(),
    requiredActivityIds: z.array(z.string().uuid()).max(3).optional(),
    requiredStops: z
      .array(
        z.object({
          title: z.string().trim().min(2).max(80),
          searchQuery: z.string().trim().max(80).nullable(),
          kind: z.enum(['activity', 'meal', 'snack']),
          durationMinutes: z.number().int().min(15).max(480),
          costEur: z.number().int().min(0).max(1000),
        }),
      )
      .max(3)
      .optional(),
    slots: z
      .array(z.enum(['main', 'meal', 'snack']))
      .max(5)
      .optional(),
    excludeActivityIds: z.array(z.string().max(100)).max(100).default([]),
    keep: z
      .record(
        z.string(),
        z.object({
          activityId: z.string(),
          place: placeSchema.nullable(),
          alternatives: z.array(placeSchema).max(2).optional(),
        }),
      )
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

type SettingsRow = typeof settings.$inferSelect;

/** Exact home pin when set, else the rounded town; used for travel times and route links only. */
export function homePoint(row: SettingsRow): LatLng {
  return row.homeExactLat !== null && row.homeExactLng !== null
    ? { lat: row.homeExactLat, lng: row.homeExactLng }
    : { lat: row.homeLat, lng: row.homeLng };
}

// External place searches only ever see a ~1 km grid, never the exact home pin.
const toGrid = (p: LatLng): LatLng => ({
  lat: Math.round(p.lat * 100) / 100,
  lng: Math.round(p.lng * 100) / 100,
});

export async function loadPlannerDefaults() {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!row) throw new Error('Settings missing – run npm run db:seed');
  return {
    transport: row.defaultTransport as Transport,
    budgetEur: row.defaultBudgetEur,
    homeName: row.homeName,
    // Rounded to ~1 km in settings; shown as map centre.
    home: { lat: row.homeLat, lng: row.homeLng },
    maxRadiusKm: row.maxRadiusKm,
  };
}

async function placesLimitReached(now: Date): Promise<boolean> {
  const limits = getLimits();
  if (limits.places.provider !== 'google' || !process.env.GOOGLE_PLACES_API_KEY) return false;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(apiUsage)
    .where(and(eq(apiUsage.provider, 'google_places'), eq(apiUsage.day, dayKey(now))));
  return Number(row?.n ?? 0) >= limits.places.dailyLimit;
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

  const required = (input.requiredStops ?? []).map((stop, i): Activity => ({
    id: `adhoc-${i}`,
    title: stop.title,
    description: '',
    category: stop.kind === 'activity' ? 'activity' : 'food',
    tags: stop.kind === 'activity' ? [] : ['food', stop.kind],
    costMinEur: stop.costEur,
    costMaxEur: stop.costEur,
    durationMinutes: stop.durationMinutes,
    weather: {},
    transports: [],
    atHome: false,
    // Ad-hoc stops are searched by text (Google); there is no matching OSM category.
    placeType: stop.searchQuery ? 'custom' : null,
    placeQuery: stop.searchQuery,
    timesOfDay: [],
    seasons: [],
    preparation: null,
  }));
  const catalog = activityRows.map(toActivity);
  required.push(...catalog.filter((a) => input.requiredActivityIds?.includes(a.id)));
  const activities = [...catalog, ...required.filter((a) => a.id.startsWith('adhoc-'))];
  const townLocation = { lat: home.homeLat, lng: home.homeLng };
  const area = input.areaPoint
    ? {
        name: input.areaPoint.name,
        location: { lat: input.areaPoint.lat, lng: input.areaPoint.lng },
      }
    : input.area
      ? await getGeocoder().find(input.area)
      : null;
  if (input.area && !area) throw new AreaNotFoundError(input.area);
  const weatherHours = await getWeatherProvider()
    .hourly(area?.location ?? townLocation, start, end)
    .catch(() => []);

  const keep: PlanRequest['keep'] = {};
  for (const [index, k] of Object.entries(input.keep ?? {})) {
    const kept = activities.find((a) => a.id === k.activityId);
    if (kept) {
      keep[Number(index)] = {
        activity: kept,
        place: k.place as Place | null,
        alternatives: (k.alternatives ?? []) as Place[],
      };
    }
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
      cuisine: input.cuisine ?? null,
      area,
      startInArea: input.startInArea,
      endInArea: input.endInArea,
      // Always allowed; the planner still tries to stay within budget first.
      allowOverBudget: true,
      maxDistanceKm: input.maxDistanceKm ?? null,
      required,
      slots: input.slots,
      excludeActivityIds: input.excludeActivityIds,
      keep,
    },
    {
      home: homePoint(home),
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
          center: toGrid(center),
          radiusKm,
          maxResults: 10,
          free: a.costMaxEur === 0 && !a.id.startsWith('adhoc-'),
        }),
      random: Math.random,
    },
  );

  const rail = getRail();
  const hasTrains =
    plan.items.some((i) => i.travelBefore?.mode === 'train') || plan.travelHome?.mode === 'train';
  if (rail && hasTrains) {
    const routine = routines.find((r) => r.transport === input.transport);
    await attachTrains(
      plan,
      {
        start,
        end,
        transport: input.transport,
        home: homePoint(home),
        homeGrid: townLocation,
        startPoint: plan.startsInArea && area ? area.location : undefined,
        routine: routine && {
          transport: routine.transport as Transport,
          firstLegMinutes: routine.firstLegMinutes,
          bufferMinutes: routine.bufferMinutes,
        },
      },
      rail,
    ).catch(() => {
      // Estimates stay in place; the plan is still usable.
      plan.warnings = [...plan.warnings, 'trains_unavailable'];
    });
  }

  const suggested = plan.items
    .map((i) => i.activity.id)
    // Ad-hoc stops from the chat are not stored activities.
    .filter((id) => activityRows.some((a) => a.id === id));
  if (suggested.length > 0) {
    await db.insert(suggestionLog).values(suggested.map((activityId) => ({ activityId })));
  }
  if (await placesLimitReached(now)) plan.warnings.push('places_daily_limit');
  return { plan, input, area };
}

export type IdeaTeaser = {
  id: string;
  title: string;
  durationMinutes: number;
  costMinEur: number;
  costMaxEur: number;
  tags: string[];
};

/**
 * A few catalog ideas that fit the next outing (season, time of day, weather) – no place
 * lookups, so showing them on the home screen costs nothing.
 */
export async function ideasForNextOuting(now = new Date(), count = 3): Promise<IdeaTeaser[]> {
  const db = getDb();
  const [[home], rows] = await Promise.all([
    db.select().from(settings).where(eq(settings.id, 1)).limit(1),
    db.select().from(activity).where(eq(activity.status, 'active')),
  ]);
  if (!home) return [];
  const outing = nextOuting(now);
  const start = fromLocal(outing.date, outing.startTime);
  const end = fromLocal(outing.endDate, outing.endTime);
  const hours = await getWeatherProvider()
    .hourly({ lat: home.homeLat, lng: home.homeLng }, start, end)
    .catch(() => []);
  const weather = summarizeWeather(hours, start, end, now);
  const fits = rows
    .map(toActivity)
    .filter(
      (a) =>
        a.category !== 'food' &&
        !a.transports.includes('bike') &&
        (a.seasons.length === 0 || a.seasons.includes(seasonOf(start))) &&
        (a.timesOfDay.length === 0 || a.timesOfDay.includes(timeOfDay(start))) &&
        fitsWeather(a, weather),
    );
  return fits
    .map((a) => ({ a, key: Math.random() }))
    .sort((x, y) => x.key - y.key)
    .slice(0, count)
    .map(({ a }) => ({
      id: a.id,
      title: a.title,
      durationMinutes: a.durationMinutes,
      costMinEur: a.costMinEur,
      costMaxEur: a.costMaxEur,
      tags: a.tags,
    }));
}
