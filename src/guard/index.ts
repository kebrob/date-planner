import { getLimits } from '@/config/limits';
import { getDb } from '@/db/client';
import { CostGuard } from './guard';
import { toGuardLimits } from './limits';
import { PostgresUsageStore } from './postgres-store';

let instance: CostGuard | undefined;

export function getCostGuard(): CostGuard {
  if (!instance) {
    const limits = getLimits();
    instance = new CostGuard({
      store: new PostgresUsageStore(getDb()),
      limits: toGuardLimits(limits),
      enabled: { anthropic: limits.ai.enabled, google_places: limits.places.provider === 'google' },
    });
  }
  return instance;
}

