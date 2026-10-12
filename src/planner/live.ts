import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { getRail } from '@/adapters';
import type { TrainLeg } from '@/core/planner/types';
import { getDb } from '@/db/client';
import { datePlan, planItem } from '@/db/schema';
import { refreshSoonTrains } from './refresh';
import { addMinutes } from '@/lib/time';
import type { StationStop } from '@/ports/rail';

// Show a train from this long before the date starts until it has arrived.
const LOOKAHEAD_HOURS = 12;

export type LiveTrain = {
  planId: string;
  /** Where the train takes you, e.g. the venue or "Home". */
  destination: string;
  train: TrainLeg;
  cancelled: boolean;
};

type StoredLeg = { train?: TrainLeg; transfers?: TrainLeg[] } | null;

/** Trains of a leg that can be followed live; expected ones are not real runs yet. */
const liveTrains = (leg: StoredLeg) =>
  [leg?.train, ...(leg?.transfers ?? [])].filter(
    (t): t is TrainLeg => t !== undefined && !t.expected,
  );

/** The next train of an accepted date that has not arrived yet, with realtime data if available. */
export async function nextTrain(now = new Date()): Promise<LiveTrain | null> {
  await refreshSoonTrains(now, LOOKAHEAD_HOURS).catch(() => undefined);
  const db = getDb();
  const plans = await db
    .select({ id: datePlan.id, travelHome: datePlan.travelHome })
    .from(datePlan)
    .where(
      and(
        eq(datePlan.status, 'accepted'),
        gte(datePlan.endsAt, addMinutes(now, -3 * 60)),
        lte(datePlan.startsAt, addMinutes(now, LOOKAHEAD_HOURS * 60)),
      ),
    )
    .orderBy(asc(datePlan.startsAt))
    .limit(3);
  if (plans.length === 0) return null;

  const items = await db
    .select({ planId: planItem.planId, title: planItem.title, travel: planItem.travel })
    .from(planItem)
    .where(
      inArray(
        planItem.planId,
        plans.map((p) => p.id),
      ),
    )
    .orderBy(asc(planItem.position));

  const legs = plans.flatMap((p) => [
    ...items
      .filter((i) => i.planId === p.id)
      .flatMap((i) =>
        liveTrains(i.travel as StoredLeg).map((train) => ({
          planId: p.id,
          destination: i.title,
          train,
        })),
      ),
    ...liveTrains(p.travelHome as StoredLeg).map((train) => ({
      planId: p.id,
      destination: 'Home',
      train,
    })),
  ]);
  const next = legs.find((l) => new Date(l.train.arrival) > now);
  if (!next) return null;
  return refreshTrain({ ...next, cancelled: false });
}

/** Applies the latest delay, platform and cancellation; keeps the stored data on any failure. */
async function refreshTrain(live: LiveTrain): Promise<LiveTrain> {
  const rail = getRail();
  if (!rail) return live;
  const { train } = live;
  const stop: StationStop = {
    id: train.stopId,
    category: train.category,
    number: '',
    line: train.line,
    arrival: null,
    departure: {
      planned: new Date(train.plannedDeparture),
      actual: new Date(train.departure),
      platform: train.platform,
      plannedPlatform: train.plannedPlatform,
      cancelled: false,
      path: [],
    },
  };
  try {
    const fresh = (await rail.timetable.refresh(train.from.eva, stop)).departure!;
    // Only the departure station is queried; the arrival moves with the departure delay.
    const delayMs = fresh.actual.getTime() - fresh.planned.getTime();
    return {
      ...live,
      cancelled: fresh.cancelled,
      train: {
        ...train,
        departure: fresh.actual.toISOString(),
        arrival: new Date(new Date(train.plannedArrival).getTime() + delayMs).toISOString(),
        platform: fresh.platform,
      },
    };
  } catch {
    return live;
  }
}
