import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const transportMode = pgEnum('transport_mode', ['deutschlandticket', 'car', 'walk', 'bike']);
export const activityStatus = pgEnum('activity_status', ['draft', 'active', 'blocked']);
export const activitySource = pgEnum('activity_source', ['manual', 'claude', 'import']);
export const planStatus = pgEnum('plan_status', ['suggested', 'accepted', 'done', 'discarded']);
export const paidProvider = pgEnum('paid_provider', ['anthropic', 'google_places']);
export const callStatus = pgEnum('call_status', ['reserved', 'success', 'error']);

/** Single-row table; the app has exactly one shared account. */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  homeName: text('home_name').notNull(),
  homePostalCode: text('home_postal_code').notNull(),
  // Rounded to the postal code area; never a street address.
  homeLat: doublePrecision('home_lat').notNull(),
  homeLng: doublePrecision('home_lng').notNull(),
  // Optional exact pin, only for travel times and route links; never sent to search or weather APIs.
  homeExactLat: doublePrecision('home_exact_lat'),
  homeExactLng: doublePrecision('home_exact_lng'),
  defaultTransport: transportMode('default_transport').notNull().default('deutschlandticket'),
  defaultBudgetEur: integer('default_budget_eur').notNull().default(50),
  maxRadiusKm: integer('max_radius_km').notNull().default(80),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const travelRoutine = pgTable('travel_routine', {
  id: uuid('id').primaryKey().defaultRandom(),
  transport: transportMode('transport').notNull(),
  description: text('description').notNull(),
  firstLegMode: transportMode('first_leg_mode'),
  firstLegMinutes: integer('first_leg_minutes').notNull().default(0),
  bufferMinutes: integer('buffer_minutes').notNull().default(0),
  originStation: text('origin_station'),
  createdAt: createdAt(),
});

export type WeatherRequirement = {
  dryOnly?: boolean;
  minTempC?: number;
  maxTempC?: number;
};

export const activity = pgTable(
  'activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    tags: text('tags').array().notNull().default([]),
    costMinEur: integer('cost_min_eur').notNull().default(0),
    costMaxEur: integer('cost_max_eur').notNull().default(0),
    durationMinutes: integer('duration_minutes').notNull(),
    weather: jsonb('weather').$type<WeatherRequirement>().notNull().default({}),
    transports: transportMode('transports').array().notNull().default([]),
    atHome: boolean('at_home').notNull().default(false),
    // Provider-neutral place type, e.g. "miniature_golf"; null for activities without a venue.
    placeType: text('place_type'),
    placeQuery: text('place_query'),
    timesOfDay: text('times_of_day').array().notNull().default([]),
    seasons: text('seasons').array().notNull().default([]),
    preparation: text('preparation'),
    status: activityStatus('status').notNull().default('draft'),
    source: activitySource('source').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (t) => [index('activity_status_idx').on(t.status)],
);

export const datePlan = pgTable('date_plan', {
  id: uuid('id').primaryKey().defaultRandom(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  parameters: jsonb('parameters').notNull(),
  weather: jsonb('weather'),
  totalCostEur: integer('total_cost_eur').notNull().default(0),
  overBudgetEur: integer('over_budget_eur').notNull().default(0),
  status: planStatus('status').notNull().default('suggested'),
  isFavorite: boolean('is_favorite').notNull().default(false),
  note: text('note'),
  areaName: text('area_name'),
  travelHome: jsonb('travel_home'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const planItem = pgTable('plan_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => datePlan.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  activityId: uuid('activity_id').references(() => activity.id, { onDelete: 'set null' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
  slot: text('slot').notNull().default('main'),
  preparation: text('preparation'),
  atHome: boolean('at_home').notNull().default(false),
  openingHoursUnknown: boolean('opening_hours_unknown').notNull().default(false),
  // Provider id and display name are kept permanently; full place data only until the date has
  // passed (provider terms restrict long-term storage), see archivedPlace().
  placeProvider: text('place_provider'),
  placeId: text('place_id'),
  placeName: text('place_name'),
  place: jsonb('place'),
  alternatives: jsonb('alternatives').notNull().default([]),
  costEur: integer('cost_eur').notNull().default(0),
  travel: jsonb('travel'),
});

export const suggestionLog = pgTable(
  'suggestion_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activity.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => datePlan.id, { onDelete: 'set null' }),
    accepted: boolean('accepted').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('suggestion_log_activity_idx').on(t.activityId, t.createdAt)],
);

export const apiUsage = pgTable(
  'api_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paidProvider('provider').notNull(),
    status: callStatus('status').notNull().default('reserved'),
    estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull(),
    actualCostUsd: doublePrecision('actual_cost_usd'),
    day: text('day').notNull(),
    month: text('month').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('api_usage_provider_day_idx').on(t.provider, t.day),
    index('api_usage_provider_month_idx').on(t.provider, t.month),
    index('api_usage_created_at_idx').on(t.createdAt),
  ],
);

export const chatMessage = pgTable('chat_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  role: text('role').notNull(),
  content: jsonb('content').notNull(),
  createdAt: createdAt(),
});

export const passkey = pgTable('passkey', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports').array().notNull().default([]),
  deviceName: text('device_name').notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

export const session = pgTable('session', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const authChallenge = pgTable('auth_challenge', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const loginAttempt = pgTable(
  'login_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipHash: text('ip_hash').notNull(),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempt_ip_idx').on(t.ipHash, t.createdAt)],
);

export const tagWeight = pgTable(
  'tag_weight',
  {
    tag: text('tag').notNull(),
    context: text('context').notNull().default('any'),
    weight: doublePrecision('weight').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tag, t.context] })],
);

export const trip = pgTable('trip', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  input: jsonb('input').notNull(),
  plan: jsonb('plan').notNull(),
  isFavorite: boolean('is_favorite').notNull().default(false),
  createdAt: createdAt(),
});
