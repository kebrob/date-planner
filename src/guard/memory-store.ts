import { dayKey, monthKey } from './periods';
import type {
  CallStatus,
  DenyReason,
  PaidProvider,
  ReserveRequest,
  UsageSnapshot,
  UsageStore,
} from './types';

type Entry = {
  id: string;
  provider: PaidProvider;
  at: Date;
  status: CallStatus;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
};

/** In-process store for tests. */
export class MemoryUsageStore implements UsageStore {
  readonly entries: Entry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;

  async reserve(request: ReserveRequest, decide: (s: UsageSnapshot) => DenyReason | null) {
    const run = this.queue.then(async () => {
      // Yield so that concurrent callers really interleave in tests.
      await Promise.resolve();
      const reason = decide(this.snapshot(request));
      if (reason) return { ok: false as const, reason };
      const id = String(this.nextId++);
      this.entries.push({
        id,
        provider: request.provider,
        at: request.now,
        status: 'reserved',
        estimatedCostUsd: request.estimatedCostUsd,
        actualCostUsd: null,
      });
      return { ok: true as const, id };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async settle(id: string, status: 'success' | 'error', actualCostUsd: number | null) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`Unknown reservation ${id}`);
    entry.status = status;
    entry.actualCostUsd = actualCostUsd;
  }

  private snapshot({ provider, now }: ReserveRequest): UsageSnapshot {
    const own = this.entries.filter((e) => e.provider === provider);
    const today = own.filter((e) => dayKey(e.at) === dayKey(now));
    const month = own.filter((e) => monthKey(e.at) === monthKey(now));
    const cost = (e: Entry) => e.actualCostUsd ?? e.estimatedCostUsd;
    return {
      dayCostUsd: today.reduce((sum, e) => sum + cost(e), 0),
      monthCostUsd: month.reduce((sum, e) => sum + cost(e), 0),
      dayRequests: today.length,
      lastMinuteCalls: this.entries.filter((e) => now.getTime() - e.at.getTime() < 60_000).length,
      recentStatuses: own
        .filter((e) => e.status !== 'reserved')
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((e) => ({ status: e.status, at: e.at })),
    };
  }
}
