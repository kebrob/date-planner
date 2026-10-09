import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { apiUsage } from '@/db/schema';
import { dayKey, monthKey } from './periods';
import type { CallStatus, DenyReason, ReserveRequest, UsageSnapshot, UsageStore } from './types';

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
      const minuteAgo = new Date(request.now.getTime() - 60_000);
      // One round trip for the whole snapshot; matters with remote database latency.
      const result = await tx.execute<{
        day_cost: string | number;
        day_count: string | number;
        month_cost: string | number;
        minute_count: string | number;
        recent: { status: CallStatus; at: string }[] | null;
      }>(sql`
        select
          (select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)
             from api_usage where provider = ${request.provider} and day = ${day}) as day_cost,
          (select count(*) from api_usage where provider = ${request.provider} and day = ${day}) as day_count,
          (select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)
             from api_usage where provider = ${request.provider} and month = ${month}) as month_cost,
          (select count(*) from api_usage where created_at >= ${minuteAgo}) as minute_count,
          (select json_agg(r) from (
             select status, created_at as at from api_usage
             where provider = ${request.provider} and status <> 'reserved'
             order by created_at desc limit ${RECENT_STATUS_COUNT}) r) as recent
      `);
      const snapshot = result.rows[0];

      const reason = decide({
        dayCostUsd: Number(snapshot?.day_cost ?? 0),
        monthCostUsd: Number(snapshot?.month_cost ?? 0),
        dayRequests: Number(snapshot?.day_count ?? 0),
        lastMinuteCalls: Number(snapshot?.minute_count ?? 0),
        recentStatuses: (snapshot?.recent ?? []).map((r) => ({
          status: r.status,
          at: new Date(r.at),
        })),
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
