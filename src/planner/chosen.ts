import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getPlacesProvider } from '@/adapters';
import { toActivityInsert } from '@/ai/ideas';
import { getDb } from '@/db/client';
import { activity, settings } from '@/db/schema';
import { TEXT_SEARCH_TYPE } from '@/ports/place-types';
import type { LatLng, Place } from '@/ports/places';
import { placesLimitReached, toGrid } from './service';

export type IdeaOption = {
  id: string;
  title: string;
  durationMinutes: number;
  costMinEur: number;
  costMaxEur: number;
  kind: 'activity' | 'meal' | 'snack';
  atHome: boolean;
  /** Words to match against besides the title (tags, category). */
  keywords: string;
};

/** Active ideas for the picker; small enough to filter on the device. */
export async function listIdeaOptions(): Promise<IdeaOption[]> {
  const rows = await getDb()
    .select()
    .from(activity)
    .where(eq(activity.status, 'active'))
    .orderBy(activity.title);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    durationMinutes: r.durationMinutes,
    costMinEur: r.costMinEur,
    costMaxEur: r.costMaxEur,
    kind: r.category !== 'food' ? 'activity' : r.tags.includes('snack') ? 'snack' : 'meal',
    atHome: r.atHome,
    keywords: [r.category, r.placeQuery ?? '', ...r.tags].join(' ').toLowerCase(),
  }));
}

// Around the chosen area (or home); wide enough for a town and its surroundings.
const SEARCH_RADIUS_KM = 15;
const MAX_RESULTS = 6;

export const placeSearchSchema = z.object({
  query: z.string().trim().min(2).max(80),
  near: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable(),
});

/**
 * Venues for a free-text search; one paid lookup through the cost guard, only on an explicit tap.
 * `limitReached` explains an empty result caused by the daily limit.
 */
export async function searchPlaces(
  raw: z.input<typeof placeSearchSchema>,
): Promise<{ places: Place[]; limitReached: boolean }> {
  const { query, near } = placeSearchSchema.parse(raw);
  let center: LatLng | null = near;
  if (!center) {
    const [home] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (!home) throw new Error('Settings missing');
    center = { lat: home.homeLat, lng: home.homeLng };
  }
  const places = await getPlacesProvider()
    .search({
      placeType: TEXT_SEARCH_TYPE,
      query,
      center: toGrid(center),
      radiusKm: SEARCH_RADIUS_KM,
      maxResults: MAX_RESULTS,
    })
    .catch(() => []);
  return { places, limitReached: places.length === 0 && (await placesLimitReached(new Date())) };
}

export const newIdeaSchema = z.object({
  title: z.string().trim().min(2).max(80),
  kind: z.enum(['activity', 'meal', 'snack']),
  durationMinutes: z.number().int().min(15).max(600),
  costEur: z.number().int().min(0).max(1000),
  query: z.string().trim().min(2).max(80),
});

/**
 * Saves a stop found by search as an active idea (the user chose it, so no review as draft).
 * An idea with the same title is reused instead of duplicated, and activated: the planner only
 * uses active ideas, so a draft or blocked one would silently drop the chosen stop.
 */
export async function addIdea(raw: z.input<typeof newIdeaSchema>): Promise<string> {
  const idea = newIdeaSchema.parse(raw);
  const db = getDb();
  const [existing] = await db
    .select({ id: activity.id, status: activity.status })
    .from(activity)
    .where(sql`lower(${activity.title}) = lower(${idea.title})`)
    .limit(1);
  if (existing) {
    if (existing.status !== 'active') {
      await db.update(activity).set({ status: 'active' }).where(eq(activity.id, existing.id));
    }
    return existing.id;
  }
  const [row] = await db
    .insert(activity)
    .values({
      ...toActivityInsert(
        {
          title: idea.title,
          description: '',
          kind: idea.kind,
          cuisine: null,
          tags: [],
          costMinEur: idea.costEur,
          costMaxEur: idea.costEur,
          durationMinutes: idea.durationMinutes,
          atHome: false,
          placeType: TEXT_SEARCH_TYPE,
          placeQuery: idea.query,
          dryOnly: false,
          minTempC: null,
          timesOfDay: [],
          seasons: [],
          preparation: null,
        },
        'manual',
      ),
      status: 'active',
    })
    .returning({ id: activity.id });
  return row!.id;
}
