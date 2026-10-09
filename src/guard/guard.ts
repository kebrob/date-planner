import { decide } from './policy';
import type { DenyReason, GuardLimits, PaidProvider, UsageStore } from './types';

export class GuardDeniedError extends Error {
  constructor(
    readonly provider: PaidProvider,
    readonly reason: DenyReason,
  ) {
    super(`Call to ${provider} denied: ${reason}`);
    this.name = 'GuardDeniedError';
  }
}

export type GuardedCall<T> = () => Promise<{ result: T; actualCostUsd: number }>;

export type CostGuardOptions = {
  store: UsageStore;
  limits: GuardLimits;
  /** Kill switch per provider; disabled providers are denied without touching the store. */
  enabled?: Partial<Record<PaidProvider, boolean>>;
  now?: () => Date;
};

/**
 * Every paid external call must go through `run`: reserve worst-case cost, call, settle actual cost.
 * Fails closed: if usage cannot be determined, the call is denied.
 */
export class CostGuard {
  private readonly now: () => Date;

  constructor(private readonly options: CostGuardOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async run<T>(provider: PaidProvider, estimatedCostUsd: number, call: GuardedCall<T>): Promise<T> {
    if (this.options.enabled?.[provider] === false) {
      throw new GuardDeniedError(provider, 'disabled');
    }

    const request = { provider, estimatedCostUsd, now: this.now() };
    let reservation: Awaited<ReturnType<UsageStore['reserve']>>;
    try {
      reservation = await this.options.store.reserve(request, (snapshot) =>
        decide(snapshot, request, this.options.limits),
      );
    } catch {
      throw new GuardDeniedError(provider, 'store_unavailable');
    }
    if (!reservation.ok) throw new GuardDeniedError(provider, reservation.reason);

    let outcome: { result: T; actualCostUsd: number };
    try {
      outcome = await call();
    } catch (error) {
      // Cost of a failed call is unknown; keep the reserved estimate as the conservative value.
      await this.options.store.settle(reservation.id, 'error', null).catch(() => undefined);
      throw error;
    }
    await this.options.store.settle(reservation.id, 'success', outcome.actualCostUsd);
    return outcome.result;
  }
}
