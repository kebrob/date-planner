import type { Limits } from '@/config/limits';
import type { GuardLimits } from './types';

export function toGuardLimits(limits: Limits): GuardLimits {
  return {
    providers: {
      anthropic: {
        dailyCostUsd: limits.ai.dailyBudgetUsd,
        monthlyCostUsd: limits.ai.monthlyBudgetUsd,
        dailyRequests: limits.ai.maxApiCallsPerDay,
      },
      google_places: { dailyRequests: limits.places.dailyLimit },
    },
    callsPerMinute: limits.paidCallsPerMinute,
    circuitBreaker: { failureThreshold: 5, cooldownMs: 10 * 60_000 },
  };
}
