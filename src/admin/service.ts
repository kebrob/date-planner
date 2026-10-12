import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getGeocoder } from '@/adapters';
import { getAnthropic, MODEL, untilDeadline } from '@/ai/client';
import {
  buildExportPrompt,
  generateIdeas,
  parseImport,
  toActivityInsert,
  withoutDuplicates,
  type Idea,
} from '@/ai/ideas';
import { getLimits } from '@/config/limits';
import { distanceKm } from '@/core/planner/geo';
import { CUISINES } from '@/core/planner/types';
import { getDb } from '@/db/client';
import { activity, apiUsage, settings, travelRoutine } from '@/db/schema';
import { getCostGuard } from '@/guard';
import { dayKey, monthKey } from '@/guard/periods';
import { PLACE_TYPES, TEXT_SEARCH_TYPE } from '@/ports/place-types';

const transport = z.enum(['deutschlandticket', 'car', 'walk', 'bike']);

export class AdminInputError extends Error {}

// ---------- Settings ----------

export const settingsSchema = z.object({
  homeName: z.string().trim().min(2).max(60),
  homePostalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'German postal code with 5 digits'),
  defaultTransport: transport,
  defaultBudgetEur: z.coerce.number().int().min(0).max(1000),
  maxRadiusKm: z.coerce.number().int().min(5).max(300),
});

export async function getSettings() {
  const [row] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!row) throw new Error('Settings missing – run npm run db:seed');
  return row;
}

export async function saveSettings(raw: unknown): Promise<void> {
  const input = settingsSchema.parse(raw);
  const area = await getGeocoder()
    .find(`${input.homePostalCode} ${input.homeName}`)
    .catch(() => null);
  const fallback = area
    ? null
    : await getGeocoder()
        .find(input.homeName)
        .catch(() => null);
  const location = (area ?? fallback)?.location;
  if (!location) throw new AdminInputError(`Couldn't find "${input.homeName}".`);
  const current = await getSettings();
  const moved =
    current.homeName !== input.homeName || current.homePostalCode !== input.homePostalCode;
  await getDb()
    .update(settings)
    .set({
      ...input,
      // A pin from the previous town would silently skew every travel time.
      ...(moved ? { homeExactLat: null, homeExactLng: null } : {}),
      // Rounded to ~1 km on purpose: no street-level home location is stored or sent anywhere.
      homeLat: Math.round(location.lat * 100) / 100,
      homeLng: Math.round(location.lng * 100) / 100,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));
}

// Close enough to the town that a mis-tap far away is rejected.
const MAX_PIN_DISTANCE_KM = 30;

const homePinSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .nullable();

/** Exact home pin for travel times and route links; null removes it. */
export async function saveHomePin(raw: unknown): Promise<void> {
  const pin = homePinSchema.parse(raw);
  const current = await getSettings();
  if (
    pin &&
    distanceKm(pin, { lat: current.homeLat, lng: current.homeLng }) > MAX_PIN_DISTANCE_KM
  ) {
    throw new AdminInputError(`The pin is too far from ${current.homeName}.`);
  }
  await getDb()
    .update(settings)
    .set({
      // ~10 m is plenty for travel times.
      homeExactLat: pin ? Math.round(pin.lat * 10_000) / 10_000 : null,
      homeExactLng: pin ? Math.round(pin.lng * 10_000) / 10_000 : null,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));
}

// ---------- Travel routines ----------

export const routineSchema = z.object({
  transport,
  description: z.string().trim().min(2).max(120),
  firstLegMode: transport.nullable(),
  firstLegMinutes: z.coerce.number().int().min(0).max(120),
  bufferMinutes: z.coerce.number().int().min(0).max(60),
  originStation: z.string().trim().max(60).nullable(),
});

export function listRoutines() {
  return getDb().select().from(travelRoutine).orderBy(asc(travelRoutine.createdAt));
}

export async function saveRoutine(id: string | null, raw: unknown): Promise<void> {
  const input = routineSchema.parse(raw);
  const db = getDb();
  if (id) await db.update(travelRoutine).set(input).where(eq(travelRoutine.id, id));
  else await db.insert(travelRoutine).values(input);
}

export async function deleteRoutine(id: string): Promise<void> {
  await getDb().delete(travelRoutine).where(eq(travelRoutine.id, id));
}

// ---------- Activities ----------

const optionalInt = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce.number().int().min(-20).max(40).nullable(),
);

export const activityFormSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300),
    kind: z.enum(['activity', 'meal', 'snack']),
    cuisine: z.enum(CUISINES).nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10),
    costMinEur: z.coerce.number().int().min(0).max(1000),
    costMaxEur: z.coerce.number().int().min(0).max(1000),
    durationMinutes: z.coerce.number().int().min(15).max(720),
    transports: z.array(transport),
    atHome: z.boolean(),
    placeType: z.enum([...PLACE_TYPES, TEXT_SEARCH_TYPE]).nullable(),
    placeQuery: z.string().trim().max(80).nullable(),
    dryOnly: z.boolean(),
    minTempC: optionalInt,
    timesOfDay: z.array(z.enum(['morning', 'afternoon', 'evening', 'night'])),
    seasons: z.array(z.enum(['spring', 'summer', 'autumn', 'winter'])),
    preparation: z.string().trim().max(200).nullable(),
    status: z.enum(['draft', 'active', 'blocked']),
  })
  .refine((v) => v.costMinEur <= v.costMaxEur, { message: 'Min cost must not exceed max cost' })
  .refine((v) => v.atHome || !v.placeType || v.placeQuery, {
    message: 'A search term is needed when a place type is set',
  });

export type ActivityForm = z.output<typeof activityFormSchema>;

/** Inverse of toActivityInsert for editing: splits food tags into kind and cuisine. */
export function toActivityForm(row: typeof activity.$inferSelect): ActivityForm {
  const kind =
    row.category === 'food' ? (row.tags.includes('snack') ? 'snack' : 'meal') : 'activity';
  const cuisine = (CUISINES as readonly string[]).find((c) => row.tags.includes(c)) ?? null;
  return {
    title: row.title,
    description: row.description,
    kind,
    cuisine: cuisine as ActivityForm['cuisine'],
    tags: row.tags.filter((t) => !['food', 'meal', 'snack', ...CUISINES].includes(t)),
    costMinEur: row.costMinEur,
    costMaxEur: row.costMaxEur,
    durationMinutes: row.durationMinutes,
    transports: row.transports,
    atHome: row.atHome,
    placeType: row.placeType as ActivityForm['placeType'],
    placeQuery: row.placeQuery,
    dryOnly: row.weather.dryOnly ?? false,
    minTempC: row.weather.minTempC ?? null,
    timesOfDay: row.timesOfDay as ActivityForm['timesOfDay'],
    seasons: row.seasons as ActivityForm['seasons'],
    preparation: row.preparation,
    status: row.status,
  };
}

export function fromActivityForm(raw: unknown): typeof activity.$inferInsert {
  const f = activityFormSchema.parse(raw);
  const idea: Parameters<typeof toActivityInsert>[0] = {
    title: f.title,
    description: f.description,
    kind: f.kind,
    cuisine: f.cuisine,
    tags: [],
    costMinEur: f.costMinEur,
    costMaxEur: f.costMaxEur,
    durationMinutes: f.durationMinutes,
    atHome: f.atHome,
    placeType: f.placeType,
    placeQuery: f.placeQuery || null,
    dryOnly: f.dryOnly,
    minTempC: f.minTempC,
    timesOfDay: f.timesOfDay,
    seasons: f.seasons,
    preparation: f.preparation || null,
  };
  const base = toActivityInsert(idea, 'claude');
  return {
    ...base,
    tags: [...new Set([...(base.tags ?? []), ...f.tags.map((t) => t.toLowerCase())])],
    transports: f.transports,
    status: f.status,
  };
}

export function listActivities() {
  return getDb()
    .select()
    .from(activity)
    .orderBy(
      sql`case ${activity.status} when 'draft' then 0 when 'active' then 1 else 2 end`,
      asc(activity.category),
      asc(activity.title),
    );
}

export async function getActivity(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await getDb().select().from(activity).where(eq(activity.id, id)).limit(1);
  return row ?? null;
}

async function assertUniqueTitle(title: string, exceptId: string | null) {
  const [clash] = await getDb()
    .select({ id: activity.id })
    .from(activity)
    .where(sql`lower(${activity.title}) = lower(${title.trim()})`)
    .limit(1);
  if (clash && clash.id !== exceptId) throw new AdminInputError(`"${title}" already exists.`);
}

export async function saveActivity(id: string | null, raw: unknown): Promise<string> {
  const values = fromActivityForm(raw);
  await assertUniqueTitle(values.title, id);
  const db = getDb();
  if (id) {
    // Keep the original source (manual / claude / import) when editing.
    const changes = { ...values };
    delete changes.source;
    await db.update(activity).set(changes).where(eq(activity.id, id));
    return id;
  }
  const [row] = await db
    .insert(activity)
    .values({ ...values, source: 'manual' })
    .returning({ id: activity.id });
  return row!.id;
}

export async function setActivityStatus(id: string, status: 'draft' | 'active' | 'blocked') {
  await getDb().update(activity).set({ status }).where(eq(activity.id, id));
}

export async function deleteActivity(id: string) {
  await getDb().delete(activity).where(eq(activity.id, id));
}

// ---------- Ideas: Claude API, prompt export, JSON import ----------

async function ideasContext(count: number, focus?: string) {
  const [home, titles] = await Promise.all([
    getSettings(),
    getDb().select({ title: activity.title }).from(activity),
  ]);
  return {
    homeName: home.homeName,
    existingTitles: titles.map((t) => t.title),
    count,
    focus: focus?.trim() || undefined,
  };
}

async function storeIdeas(ideas: Idea[], existing: string[], source: 'claude' | 'import') {
  const fresh = withoutDuplicates(ideas, existing);
  if (fresh.length > 0) {
    await getDb()
      .insert(activity)
      .values(fresh.map((i) => toActivityInsert(i, source)));
  }
  return { added: fresh.length, skipped: ideas.length - fresh.length };
}

export const generateSchema = z.object({
  count: z.coerce.number().int().min(1).max(10),
  focus: z.string().trim().max(120).optional(),
});

// Within the admin page's 120 s function limit, leaving time to store the ideas.
const IDEAS_TIME_BUDGET_MS = 105_000;

export async function generateIdeasWithClaude(raw: unknown) {
  if (!getLimits().ai.enabled) {
    throw new AdminInputError(
      'Claude is disabled (AI_ENABLED=false). Use the prompt export instead.',
    );
  }
  const deadline = Date.now() + IDEAS_TIME_BUDGET_MS;
  const { count, focus } = generateSchema.parse(raw);
  const ctx = await ideasContext(count, focus);
  const ideas = await generateIdeas(ctx, {
    parse: (params) => getAnthropic().beta.messages.parse(params, untilDeadline(deadline)),
    guard: getCostGuard(),
    model: MODEL,
  });
  return storeIdeas(ideas, ctx.existingTitles, 'claude');
}

export async function exportIdeasPrompt(count = 10, focus?: string): Promise<string> {
  return buildExportPrompt(await ideasContext(count, focus));
}

export async function importIdeas(text: string) {
  if (text.length > 100_000) throw new AdminInputError('Import is too large.');
  const ideas = parseImport(text);
  const ctx = await ideasContext(ideas.length);
  return storeIdeas(ideas, ctx.existingTitles, 'import');
}

// ---------- Usage ----------

export async function usageOverview(now = new Date()) {
  const db = getDb();
  const cost = sql<number>`coalesce(sum(coalesce(${apiUsage.actualCostUsd}, ${apiUsage.estimatedCostUsd})), 0)`;
  const count = sql<number>`count(*)`;
  const [rows, monthRows] = await Promise.all([
    db
      .select({ provider: apiUsage.provider, cost, count })
      .from(apiUsage)
      .where(eq(apiUsage.day, dayKey(now)))
      .groupBy(apiUsage.provider),
    db
      .select({ provider: apiUsage.provider, cost, count })
      .from(apiUsage)
      .where(eq(apiUsage.month, monthKey(now)))
      .groupBy(apiUsage.provider),
  ]);
  const pick = (list: typeof rows, provider: string) => {
    const r = list.find((x) => x.provider === provider);
    return { costUsd: Number(r?.cost ?? 0), calls: Number(r?.count ?? 0) };
  };
  const limits = getLimits();
  return {
    anthropic: {
      today: pick(rows, 'anthropic'),
      month: pick(monthRows, 'anthropic'),
      dailyBudgetUsd: limits.ai.dailyBudgetUsd,
      monthlyBudgetUsd: limits.ai.monthlyBudgetUsd,
      enabled: limits.ai.enabled,
    },
    googlePlaces: {
      today: pick(rows, 'google_places'),
      month: pick(monthRows, 'google_places'),
      dailyLimit: limits.places.dailyLimit,
      provider: limits.places.provider,
    },
  };
}
