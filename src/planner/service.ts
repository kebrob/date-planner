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
  type TravelRoutine,
} from '@/core/planner/types';
import { summarizeWeather, weatherFactor } from '@/core/planner/weather';
import { getDb } from '@/db/client';
import { findSettings, loadSettings, type Settings } from '@/db/settings';
import { activity, apiUsage, suggestionLog, travelRoutine } from '@/db/schema';
import { dayKey } from '@/guard/periods';
import { nextOuting } from './outing';
import { attachTrains } from './trains';
import { firstOpenStart } from '@/core/planner/opening-hours';
import { fitsWeather, foodKind, isFreeSearch, seasonOf, timeOfDay } from '@/core/planner/rules';
import { weightedShuffle } from '@/core/planner/random';
import { loadLearning } from '@/ratings/service';
import { placeSchema } from './schemas';
import { fromLocal } from '@/lib/time';
import type { GeoArea } from '@/ports/geocoding';
import { TEXT_SEARCH_TYPE } from '@/ports/place-types';
import type { LatLng, Place } from '@/ports/places';

export class AreaNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`Area not found: ${query}`);
  }
}

const transport = z.enum(['deutschlandticket', 'car', 'walk', 'bike']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

const customStopSchema = z.object({
  title: z.string().trim().min(2).max(80),
  kind: z.enum(['activity', 'meal', 'snack']),
  durationMinutes: z.number().int().min(15).max(600),
  costEur: z.number().int().min(0).max(1000),
  /** Search text it was found with, used if the venue has to be searched again. */
  query: z.string().trim().min(2).max(80),
});

/** A stop the user picked: one of their ideas or a one-off from a place search. */
export const chosenStopSchema = z
  .object({
    activityId: z.string().uuid().nullable(),
    custom: customStopSchema.nullable(),
    place: placeSchema.nullable(),
    /** Fixed start within the window; null = any time. */
    startTime: time.nullable(),
    /** Takes the place of the item at this position (the others are kept). */
    index: z.number().int().min(0).max(4).nullable(),
  })
  .refine((v) => (v.activityId === null) !== (v.custom === null), {
    message: 'Either an idea or a one-off stop',
  });

export type ChosenStopInput = z.input<typeof chosenStopSchema>;

export function customActivity(id: string, custom: z.output<typeof customStopSchema>): Activity {
  return {
    id,
    title: custom.title,
    description: '',
    category: custom.kind === 'activity' ? 'activity' : 'food',
    tags: custom.kind === 'activity' ? [] : ['food', custom.kind],
    costMinEur: custom.costEur,
    costMaxEur: custom.costEur,
    durationMinutes: custom.durationMinutes,
    weather: {},
    transports: [],
    atHome: false,
    // Text search only: one-off stops have no provider-neutral type.
    placeType: TEXT_SEARCH_TYPE,
    placeQuery: custom.query,
    timesOfDay: [],
    seasons: [],
    preparation: null,
  };
}

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
    chosen: z.array(chosenStopSchema).max(5).optional(),
    /** Off after the user removed stops: free time stays free. */
    fillGaps: z.boolean().optional(),
    /** Kept stops that no longer fit are left out instead of replaced (moving a plan). */
    replaceUnfit: z.boolean().optional(),
    /** Positions of added stops that may be an activity, a snack or a meal. */
    anyKindAt: z.array(z.number().int().min(0).max(4)).max(5).optional(),
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
          /** Stays at this start, e.g. the stop after a gap a new stop is added to. */
          startTime: time.optional(),
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

/**
 * The input a saved plan keeps: without re-roll state, but with stops chosen for a set time, so
 * they stay at that time when the plan is edited later.
 */
export function savedInput(input: PlanInput): PlanInput {
  const base: PlanInput = { ...input, excludeActivityIds: [] };
  delete base.keep;
  delete base.slots;
  delete base.anyKindAt;
  delete base.replaceUnfit;
  const fixed = input.chosen?.filter((c) => c.startTime && c.index === null);
  if (fixed?.length) base.chosen = fixed;
  else delete base.chosen;
  return base;
}

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

export function toRoutine(row: typeof travelRoutine.$inferSelect): TravelRoutine {
  return {
    transport: row.transport as Transport,
    firstLegMinutes: row.firstLegMinutes,
    bufferMinutes: row.bufferMinutes,
  };
}

/** Exact home pin when set, else the rounded town; used for travel times and route links only. */
export function homePoint(row: Settings): LatLng {
  return row.homeExactLat !== null && row.homeExactLng !== null
    ? { lat: row.homeExactLat, lng: row.homeExactLng }
    : { lat: row.homeLat, lng: row.homeLng };
}

// External place searches only ever see a ~1 km grid, never the exact home pin.
export const toGrid = (p: LatLng): LatLng => ({
  lat: Math.round(p.lat * 100) / 100,
  lng: Math.round(p.lng * 100) / 100,
});

export async function loadPlannerDefaults() {
  const row = await loadSettings();
  return {
    transport: row.defaultTransport as Transport,
    budgetEur: row.defaultBudgetEur,
    homeName: row.homeName,
    // Rounded to ~1 km in settings; shown as map centre.
    home: { lat: row.homeLat, lng: row.homeLng },
    maxRadiusKm: row.maxRadiusKm,
  };
}

export async function placesLimitReached(now: Date): Promise<boolean> {
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

  const [home, routines, activityRows, learning, history] = await Promise.all([
    loadSettings(),
    db.select().from(travelRoutine),
    db.select().from(activity).where(eq(activity.status, 'active')),
    loadLearning(now),
    loadHistory(now),
  ]);

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
    placeType: stop.searchQuery ? TEXT_SEARCH_TYPE : null,
    placeQuery: stop.searchQuery,
    timesOfDay: [],
    seasons: [],
    preparation: null,
  }));
  const catalog = activityRows.map(toActivity);
  required.push(...catalog.filter((a) => input.requiredActivityIds?.includes(a.id)));

  const allChosen = (input.chosen ?? []).flatMap((c, i) => {
    const a = c.activityId
      ? catalog.find((x) => x.id === c.activityId)
      : customActivity(`chosen-${i}`, c.custom!);
    return a ? [{ ...c, activity: a, place: (c.place as Place | null) ?? null }] : [];
  });
  // An idea chosen by the user that is no longer active (deleted, blocked) cannot be planned.
  const chosenMissing = allChosen.length < (input.chosen ?? []).length;
  // On re-rolls the chosen stops are usually kept items already; rejected ones stay out.
  const kept = new Set(Object.values(input.keep ?? {}).map((k) => k.activityId));
  // A stop picked for a position was chosen just now, so it wins over earlier rejections.
  const chosen = allChosen.filter(
    (c) =>
      c.index !== null ||
      (!input.excludeActivityIds.includes(c.activity.id) && !kept.has(c.activity.id)),
  );
  // A time on the start date, or on the end date for windows past midnight.
  const startOf = (t: string) => {
    const sameDay = fromLocal(input.date, t);
    return sameDay < start ? fromLocal(input.endDate, t) : sameDay;
  };
  const pins = Object.fromEntries(chosen.filter((c) => c.index !== null).map((c) => [c.index!, c]));
  // A set time outside the window counts as "any time".
  const fixedStart = (c: (typeof chosen)[number]) => {
    const at = c.startTime ? startOf(c.startTime) : null;
    return at && at >= start && at < end ? at : null;
  };
  // A venue with short opening hours (e.g. public skating) is fixed at its first open time.
  const openStart = (c: (typeof chosen)[number]) => {
    const hours = c.place?.openingHours;
    if (!hours || hours.alwaysOpen) return null;
    const first = firstOpenStart(hours, start, end, c.activity.durationMinutes);
    return first && first > start ? first : null;
  };
  const closedAllDay = chosen.filter(
    (c) =>
      c.index === null &&
      !fixedStart(c) &&
      c.place?.openingHours &&
      !firstOpenStart(c.place.openingHours, start, end, c.activity.durationMinutes),
  );
  const anchors = chosen.flatMap((c) => {
    if (c.index !== null) return [];
    const at = fixedStart(c) ?? openStart(c);
    return at ? [{ ...c, start: at }] : [];
  });
  const anyTime = chosen.filter((c) => c.index === null && !fixedStart(c) && !openStart(c));
  required.push(...anyTime.map((c) => c.activity));
  const chosenPlaces = Object.fromEntries(
    anyTime.flatMap((c) => (c.place ? [[c.activity.id, c.place] as const] : [])),
  );
  const activities = [
    ...catalog,
    ...required.filter((a) => a.id.startsWith('adhoc-')),
    // One-off chosen stops, so that kept items can refer to them.
    ...allChosen.map((c) => c.activity).filter((a) => a.id.startsWith('chosen-')),
  ];
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
      // Chosen for a set time: stays at that time when the rest changes.
      const fixed = allChosen.find((c) => c.activity.id === kept.id && c.index === null);
      const startTime = k.startTime ?? fixed?.startTime;
      const at = startTime ? startOf(startTime) : undefined;
      keep[Number(index)] = {
        activity: kept,
        place: k.place as Place | null,
        alternatives: (k.alternatives ?? []) as Place[],
        ...(at && at >= start && at < end ? { at } : {}),
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
      fillGaps: input.fillGaps,
      replaceUnfit: input.replaceUnfit,
      anyKindAt: input.anyKindAt,
      maxDistanceKm: input.maxDistanceKm ?? null,
      required,
      anchors,
      pins,
      chosenPlaces,
      // A chosen stop takes a slot of its own kind (a restaurant replacing an activity is a meal).
      slots: input.slots?.map((slot, i) =>
        pins[i] ? (foodKind(pins[i].activity) ?? 'main') : slot,
      ),
      excludeActivityIds: input.excludeActivityIds,
      keep,
    },
    {
      home: homePoint(home),
      maxRadiusKm: home.maxRadiusKm,
      routines: routines.map(toRoutine),
      activities,
      history,
      weather: summarizeWeather(weatherHours, start, end, now),
      forecast: weatherHours,
      learning,
      maxPlaceLookups: getLimits().places.maxLookupsPerPlan,
      maxFreePlaceLookups: getLimits().places.maxFreeLookupsPerPlan,
      findPlaces: (a, center, radiusKm) =>
        places.search({
          placeType: a.placeType ?? '',
          query: a.placeQuery ?? a.title,
          center: toGrid(center),
          radiusKm,
          maxResults: 10,
          free: isFreeSearch(a),
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
        routine: routine && toRoutine(routine),
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
  if (closedAllDay.length > 0) plan.warnings.push('chosen_closed');
  if (chosenMissing && !plan.warnings.includes('required_skipped')) {
    plan.warnings.push('required_skipped');
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
  const [home, rows] = await Promise.all([
    findSettings(),
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
  return weightedShuffle(fits, (a) => weatherFactor(a, weather.conditions ?? []), Math.random)
    .slice(0, count)
    .map((a) => ({
      id: a.id,
      title: a.title,
      durationMinutes: a.durationMinutes,
      costMinEur: a.costMinEur,
      costMaxEur: a.costMaxEur,
      tags: a.tags,
    }));
}
