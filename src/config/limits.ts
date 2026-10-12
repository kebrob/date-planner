import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const positiveNumber = (fallback: number) => z.coerce.number().positive().default(fallback);

// Defaults are documented in docs/betrieb/kostenlimits.md and must stay below the provider limits there.
const limitsSchema = z.object({
  AI_ENABLED: bool,
  AI_MONTHLY_BUDGET_USD: positiveNumber(15),
  AI_DAILY_BUDGET_USD: positiveNumber(2),
  AI_MAX_TOOL_ITERATIONS: positiveInt(8),
  AI_MAX_WEB_SEARCHES_CHAT: positiveInt(3),
  AI_MAX_WEB_SEARCHES_GENERATE: positiveInt(5),
  AI_MAX_WEB_SEARCHES_TRIP: positiveInt(15),
  AI_MAX_API_CALLS_PER_DAY: positiveInt(200),
  AI_REQUEST_TIMEOUT_MS: positiveInt(90_000),
  PLACES_PROVIDER: z.enum(['google', 'osm']).default('google'),
  PLACES_DAILY_LIMIT: positiveInt(25),
  PLACES_MAX_LOOKUPS_PER_PLAN: positiveInt(6),
  PLACES_MAX_FREE_LOOKUPS_PER_PLAN: positiveInt(6),
  PAID_CALLS_PER_MINUTE: positiveInt(20),
});

export type Limits = {
  ai: {
    enabled: boolean;
    monthlyBudgetUsd: number;
    dailyBudgetUsd: number;
    maxToolIterations: number;
    maxWebSearches: { chat: number; generate: number; trip: number };
    maxApiCallsPerDay: number;
    requestTimeoutMs: number;
  };
  places: {
    provider: 'google' | 'osm';
    dailyLimit: number;
    maxLookupsPerPlan: number;
    /** Searches for free ideas (OpenStreetMap first) on top of the paid ones. */
    maxFreeLookupsPerPlan: number;
  };
  paidCallsPerMinute: number;
};

export function parseLimits(env: Record<string, string | undefined>): Limits {
  const e = limitsSchema.parse(env);
  return {
    ai: {
      enabled: e.AI_ENABLED,
      monthlyBudgetUsd: e.AI_MONTHLY_BUDGET_USD,
      dailyBudgetUsd: e.AI_DAILY_BUDGET_USD,
      maxToolIterations: e.AI_MAX_TOOL_ITERATIONS,
      maxWebSearches: {
        chat: e.AI_MAX_WEB_SEARCHES_CHAT,
        generate: e.AI_MAX_WEB_SEARCHES_GENERATE,
        trip: e.AI_MAX_WEB_SEARCHES_TRIP,
      },
      maxApiCallsPerDay: e.AI_MAX_API_CALLS_PER_DAY,
      requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
    },
    places: {
      provider: e.PLACES_PROVIDER,
      dailyLimit: e.PLACES_DAILY_LIMIT,
      maxLookupsPerPlan: e.PLACES_MAX_LOOKUPS_PER_PLAN,
      maxFreeLookupsPerPlan: e.PLACES_MAX_FREE_LOOKUPS_PER_PLAN,
    },
    paidCallsPerMinute: e.PAID_CALLS_PER_MINUTE,
  };
}

let cached: Limits | undefined;

export function getLimits(): Limits {
  cached ??= parseLimits(process.env);
  return cached;
}
