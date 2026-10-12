import { describe, expect, it } from 'vitest';
import { parseLimits } from './limits';

describe('parseLimits', () => {
  it('uses documented defaults', () => {
    const limits = parseLimits({});
    expect(limits.ai.enabled).toBe(true);
    expect(limits.ai.monthlyBudgetUsd).toBe(15);
    expect(limits.ai.dailyBudgetUsd).toBe(2);
    expect(limits.ai.maxToolIterations).toBe(8);
    expect(limits.ai.maxWebSearches).toEqual({ chat: 3, generate: 5, trip: 15 });
    expect(limits.places).toEqual({
      provider: 'google',
      dailyLimit: 25,
      maxLookupsPerPlan: 6,
      maxFreeLookupsPerPlan: 6,
    });
    expect(limits.ai.maxApiCallsPerDay).toBe(200);
    expect(limits.paidCallsPerMinute).toBe(20);
  });

  it('reads overrides from env', () => {
    const limits = parseLimits({
      AI_ENABLED: 'false',
      PLACES_PROVIDER: 'osm',
      PLACES_DAILY_LIMIT: '5',
    });
    expect(limits.ai.enabled).toBe(false);
    expect(limits.places.provider).toBe('osm');
    expect(limits.places.dailyLimit).toBe(5);
  });

  it.each([
    ['AI_MAX_TOOL_ITERATIONS', '0'],
    ['AI_DAILY_BUDGET_USD', '-1'],
    ['PLACES_DAILY_LIMIT', 'abc'],
    ['AI_ENABLED', 'yes'],
  ])('rejects invalid %s=%s instead of silently disabling a limit', (key, value) => {
    expect(() => parseLimits({ [key]: value })).toThrow();
  });
});
