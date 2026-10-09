import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { apiUsage } from '@/db/schema';
import { dayKey, monthKey } from './periods';
import type { DenyReason, ReserveRequest, UsageSnapshot, UsageStore } from './types';

// Arbitrary constant key; serializes all reservations so concurrent requests cannot jointly exceed limits.
const ADVISORY_LOCK_KEY = 4_711_001;
const RECENT_STATUS_COUNT = 10;

export class PostgresUsageStore implements UsageStore {
  constructor(private readonly db: Db) {}

  async reserve(request: ReserveRequest, decide: (s: UsageSnapshot) => DenyReason | null) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

      const day = dayKey(request.now);
      const month = monthKey(request.now);
      const cost = sql<number>`coalesce(sum(coalesce(${apiUsage.actualCostUsd}, ${apiUsage.estimatedCostUsd})), 0)`;
      const own = eq(apiUsage.provider, request.provider);

      const [[dayRow], [monthRow], [minuteRow], recent] = await Promise.all([
        tx
          .select({ cost, count: sql<number>`count(*)` })
          .from(apiUsage)
          .where(and(own, eq(apiUsage.day, day))),
        tx
          .select({ cost })
          .from(apiUsage)
          .where(and(own, eq(apiUsage.month, month))),
        tx
          .select({ count: sql<number>`count(*)` })
          .from(apiUsage)
          .where(gte(apiUsage.createdAt, new Date(request.now.getTime() - 60_000))),
        tx
          .select({ status: apiUsage.status, at: apiUsage.createdAt })
          .from(apiUsage)
          .where(and(own, ne(apiUsage.status, 'reserved')))
          .orderBy(desc(apiUsage.createdAt))
          .limit(RECENT_STATUS_COUNT),
      ]);

      const reason = decide({
        dayCostUsd: Number(dayRow?.cost ?? 0),
        monthCostUsd: Number(monthRow?.cost ?? 0),
        dayRequests: Number(dayRow?.count ?? 0),
        lastMinuteCalls: Number(minuteRow?.count ?? 0),
        recentStatuses: recent,
      });
      if (reason) return { ok: false as const, reason };

      const [row] = await tx
        .insert(apiUsage)
        .values({
          provider: request.provider,
          estimatedCostUsd: request.estimatedCostUsd,
          day,
          month,
          createdAt: request.now,
        })
        .returning({ id: apiUsage.id });
      if (!row) throw new Error('Reservation insert returned no row');
      return { ok: true as const, id: row.id };
    });
  }

  async settle(id: string, status: 'success' | 'error', actualCostUsd: number | null) {
    await this.db.update(apiUsage).set({ status, actualCostUsd }).where(eq(apiUsage.id, id));
  }
}
