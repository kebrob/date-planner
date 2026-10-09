import type { DenyReason, GuardLimits, ReserveRequest, UsageSnapshot } from './types';

export function decide(
  snapshot: UsageSnapshot,
  request: ReserveRequest,
  limits: GuardLimits,
): DenyReason | null {
  const providerLimits = limits.providers[request.provider];
  const { failureThreshold, cooldownMs } = limits.circuitBreaker;

  const recent = snapshot.recentStatuses.slice(0, failureThreshold);
  const lastFailure = recent[0];
  if (
    recent.length === failureThreshold &&
    recent.every((s) => s.status === 'error') &&
    lastFailure &&
    request.now.getTime() - lastFailure.at.getTime() < cooldownMs
  ) {
    return 'circuit_open';
  }

  if (snapshot.lastMinuteCalls >= limits.callsPerMinute) return 'rate_limit';
  if (snapshot.dayRequests >= providerLimits.dailyRequests) return 'daily_requests';

  // Reserve the worst-case cost up front so a single call can never push spend past the limit.
  if (
    providerLimits.dailyCostUsd !== undefined &&
    snapshot.dayCostUsd + request.estimatedCostUsd > providerLimits.dailyCostUsd
  ) {
    return 'daily_budget';
  }
  if (
    providerLimits.monthlyCostUsd !== undefined &&
    snapshot.monthCostUsd + request.estimatedCostUsd > providerLimits.monthlyCostUsd
  ) {
    return 'monthly_budget';
  }

  return null;
}
