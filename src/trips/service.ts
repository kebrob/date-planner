import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSettings } from '@/admin/service';
import { createMessageUntil, MODEL } from '@/ai/client';
import { getGeocoder, getRail } from '@/adapters';
import { planTrip, tripInputSchema, type TripInput } from '@/ai/trip';
import { getLimits } from '@/config/limits';
import { getDb } from '@/db/client';
import { trip } from '@/db/schema';
import { getCostGuard } from '@/guard';
import { attachTripTrains, type StoredTripPlan } from './trains';

export class TripsDisabledError extends Error {}

const MAX_TRIP_ITERATIONS = 4;
// Within the trips page's 300 s function limit, leaving time for trains and storing the trip.
const TRIP_TIME_BUDGET_MS = 260_000;

export async function createTrip(raw: unknown): Promise<string> {
  const deadline = Date.now() + TRIP_TIME_BUDGET_MS;
  const input = tripInputSchema.parse(raw);
  const limits = getLimits();
  if (!limits.ai.enabled) throw new TripsDisabledError();
  const home = await getSettings();
  const plan = await planTrip(input, {
    homeName: home.homeName,
    createMessage: createMessageUntil(deadline),
    guard: getCostGuard(),
    model: MODEL,
    // Usually one or two rounds; capped so the request fits into the function time limit.
    maxIterations: Math.min(limits.ai.maxToolIterations, MAX_TRIP_ITERATIONS),
    maxWebSearches: limits.ai.maxWebSearches.trip,
    deadline,
  });
  const rail = getRail();
  const stored: StoredTripPlan = rail
    ? await attachTripTrains(
        plan,
        input,
        { lat: home.homeLat, lng: home.homeLng },
        { ...rail, geocoder: getGeocoder() },
      ).catch(() => plan)
    : plan;
  const [row] = await getDb()
    .insert(trip)
    .values({
      title: plan.title,
      startDate: input.startDate,
      endDate: input.endDate,
      input,
      plan: stored,
    })
    .returning({ id: trip.id });
  return row!.id;
}

export function listTrips() {
  return getDb()
    .select({
      id: trip.id,
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      isFavorite: trip.isFavorite,
    })
    .from(trip)
    .orderBy(desc(trip.startDate));
}

export async function getTrip(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await getDb().select().from(trip).where(eq(trip.id, id)).limit(1);
  return row ? { ...row, input: row.input as TripInput, plan: row.plan as StoredTripPlan } : null;
}

export async function setTripFavorite(id: string, isFavorite: boolean) {
  await getDb().update(trip).set({ isFavorite }).where(eq(trip.id, id));
}

export async function deleteTrip(id: string) {
  await getDb().delete(trip).where(eq(trip.id, id));
}
