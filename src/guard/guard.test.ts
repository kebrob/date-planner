import { describe, expect, it, vi } from 'vitest';
import { CostGuard, GuardDeniedError } from './guard';
import { MemoryUsageStore } from './memory-store';
import type { GuardLimits, UsageStore } from './types';

const limits: GuardLimits = {
  providers: {
    anthropic: { dailyCostUsd: 2, monthlyCostUsd: 15, dailyRequests: 200 },
    google_places: { dailyRequests: 25 },
  },
  callsPerMinute: 1000,
  circuitBreaker: { failureThreshold: 5, cooldownMs: 10 * 60_000 },
};

function setup(overrides: Partial<GuardLimits> = {}, start = new Date('2026-10-09T10:00:00Z')) {
  const store = new MemoryUsageStore();
  let now = start;
  const guard = new CostGuard({ store, limits: { ...limits, ...overrides }, now: () => now });
  return {
    store,
    guard,
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    setNow: (date: Date) => (now = date),
  };
}

const ok = (cost: number) => vi.fn(async () => ({ result: 'ok', actualCostUsd: cost }));

async function denialOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GuardDeniedError) return error.reason;
    throw error;
  }
  return null;
}

describe('CostGuard', () => {
  it('records actual cost after a successful call', async () => {
    const { guard, store } = setup();
    await expect(guard.run('anthropic', 0.5, ok(0.1))).resolves.toBe('ok');
    expect(store.entries[0]).toMatchObject({ status: 'success', actualCostUsd: 0.1 });
  });

  it('denies a call whose worst-case cost would exceed the daily budget, without calling', async () => {
    const { guard } = setup();
    await guard.run('anthropic', 1.5, ok(1.5));
    const call = ok(0.1);
    expect(await denialOf(guard.run('anthropic', 0.6, call))).toBe('daily_budget');
    expect(call).not.toHaveBeenCalled();
  });

  it('resets the daily budget at local midnight but keeps the monthly budget', async () => {
    const { guard, setNow } = setup({}, new Date('2026-10-01T08:00:00Z'));
    for (let day = 1; day <= 7; day++) {
      setNow(new Date(`2026-10-0${day}T08:00:00Z`));
      await guard.run('anthropic', 2, ok(2));
    }
    setNow(new Date('2026-10-08T08:00:00Z'));
    expect(await denialOf(guard.run('anthropic', 1.5, ok(1.5)))).toBe('monthly_budget');
  });

  it('enforces the daily request limit for Google Places', async () => {
    const { guard } = setup();
    for (let i = 0; i < 25; i++) await guard.run('google_places', 0, ok(0));
    const call = ok(0);
    expect(await denialOf(guard.run('google_places', 0, call))).toBe('daily_requests');
    expect(call).not.toHaveBeenCalled();
  });

  it('applies the per-minute emergency brake across providers', async () => {
    const { guard, advance } = setup({ callsPerMinute: 3 });
    await guard.run('anthropic', 0, ok(0));
    await guard.run('google_places', 0, ok(0));
    await guard.run('google_places', 0, ok(0));
    expect(await denialOf(guard.run('anthropic', 0, ok(0)))).toBe('rate_limit');
    advance(60_000);
    await expect(guard.run('anthropic', 0, ok(0))).resolves.toBe('ok');
  });

  it('never exceeds the budget with concurrent reservations', async () => {
    const { guard } = setup();
    const calls = Array.from({ length: 20 }, () => guard.run('anthropic', 0.3, ok(0.3)));
    const results = await Promise.allSettled(calls);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(6); // 6 × 0.30 = 1.80 ≤ 2.00 < 7 × 0.30
  });

  it('keeps the reserved estimate when a call fails and rethrows the error', async () => {
    const { guard, store } = setup();
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(guard.run('anthropic', 0.4, failing)).rejects.toThrow('boom');
    expect(store.entries[0]).toMatchObject({
      status: 'error',
      estimatedCostUsd: 0.4,
      actualCostUsd: null,
    });
  });

  it('opens the circuit after 5 consecutive failures and closes it after the cooldown', async () => {
    const { guard, advance } = setup();
    const failing = async () => {
      throw new Error('provider down');
    };
    for (let i = 0; i < 5; i++)
      await expect(guard.run('google_places', 0, failing)).rejects.toThrow();

    const call = ok(0);
    expect(await denialOf(guard.run('google_places', 0, call))).toBe('circuit_open');
    expect(call).not.toHaveBeenCalled();

    advance(10 * 60_000);
    await expect(guard.run('google_places', 0, call)).resolves.toBe('ok');
  });

  it('does not open the circuit when failures are interrupted by a success', async () => {
    const { guard } = setup();
    const failing = async () => {
      throw new Error('flaky');
    };
    for (let i = 0; i < 4; i++)
      await expect(guard.run('google_places', 0, failing)).rejects.toThrow();
    await guard.run('google_places', 0, ok(0));
    await expect(guard.run('google_places', 0, failing)).rejects.toThrow('flaky');
    await expect(guard.run('google_places', 0, ok(0))).resolves.toBe('ok');
  });

  it('fails closed when the usage store is unavailable', async () => {
    const broken: UsageStore = {
      reserve: async () => {
        throw new Error('db down');
      },
      settle: async () => undefined,
    };
    const guard = new CostGuard({ store: broken, limits });
    const call = ok(0);
    expect(await denialOf(guard.run('anthropic', 0.01, call))).toBe('store_unavailable');
    expect(call).not.toHaveBeenCalled();
  });

  it('denies disabled providers without touching the store', async () => {
    const store = new MemoryUsageStore();
    const reserve = vi.spyOn(store, 'reserve');
    const guard = new CostGuard({ store, limits, enabled: { anthropic: false } });
    const call = ok(0);
    expect(await denialOf(guard.run('anthropic', 0.01, call))).toBe('disabled');
    expect(call).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
});
