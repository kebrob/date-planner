export type PaidProvider = 'anthropic' | 'google_places';

export type CallStatus = 'reserved' | 'success' | 'error';

export type UsageSnapshot = {
  /** Sum of actual (or, if not yet settled, estimated) cost for the provider today. */
  dayCostUsd: number;
  monthCostUsd: number;
  dayRequests: number;
  /** Calls across all providers within the last 60 seconds. */
  lastMinuteCalls: number;
  /** Most recent statuses for the provider, newest first. */
  recentStatuses: { status: CallStatus; at: Date }[];
};

type ProviderLimits = {
  dailyCostUsd?: number;
  monthlyCostUsd?: number;
  dailyRequests: number;
};

export type GuardLimits = {
  providers: Record<PaidProvider, ProviderLimits>;
  callsPerMinute: number;
  circuitBreaker: { failureThreshold: number; cooldownMs: number };
};

export type DenyReason =
  | 'daily_budget'
  | 'monthly_budget'
  | 'daily_requests'
  | 'rate_limit'
  | 'circuit_open'
  | 'store_unavailable'
  | 'disabled';

export type ReserveRequest = { provider: PaidProvider; estimatedCostUsd: number; now: Date };

export interface UsageStore {
  /**
   * Atomically reads the snapshot, lets `decide` evaluate it and, if allowed, records a reservation.
   * Concurrent calls must be serialized so that limits cannot be exceeded jointly.
   */
  reserve(
    request: ReserveRequest,
    decide: (snapshot: UsageSnapshot) => DenyReason | null,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: DenyReason }>;
  settle(id: string, status: 'success' | 'error', actualCostUsd: number | null): Promise<void>;
}
