import type { TripInput, TripPlan } from '@/ai/trip';
import type { TrainLeg } from '@/core/planner/types';
import { fromLocal } from '@/lib/time';
import type { GeocodingProvider } from '@/ports/geocoding';
import type { LatLng } from '@/ports/places';
import type { RailStationFinder, RailTimetable } from '@/ports/rail';
import { findConnection, findConnectionTo, toTrainLeg } from '@/rail/connection';

export type TripTravel = TripPlan['travel'][number] & { train?: TrainLeg };
export type StoredTripPlan = Omit<TripPlan, 'travel'> & { travel: TripTravel[] };

// Outbound in the morning of the first day, back in the afternoon of the last day.
const OUTBOUND_TIME = '08:00';
const RETURN_TIME = '14:00';
const HOME_STATION_RADIUS_KM = 2;

type Deps = { stations: RailStationFinder; timetable: RailTimetable; geocoder: GeocodingProvider };

/**
 * Adds a real direct train to the first and last train leg of a trip (home → destination and
 * back). Legs needing a transfer keep Claude's notes, since the timetable API has no routing.
 */
export async function attachTripTrains(
  plan: TripPlan,
  input: TripInput,
  homeGrid: LatLng,
  deps: Deps,
): Promise<StoredTripPlan> {
  const travel: TripTravel[] = plan.travel.map((t) => ({ ...t }));
  // Without a preference Claude may still pick the train for some legs.
  if (input.transport && input.transport !== 'deutschlandticket' && input.transport !== 'train') {
    return { ...plan, travel };
  }
  const regionalOnly = input.transport === 'deutschlandticket';
  const trainLegs = travel.filter((t) => t.mode === 'train');
  const outbound = trainLegs[0];
  const back = trainLegs.length > 1 ? trainLegs.at(-1) : undefined;

  async function connect(from: LatLng, to: LatLng, date: string, time: string) {
    const connection = await findConnection(
      { from, to, departAfter: fromLocal(date, time), regionalOnly },
      deps.stations,
      deps.timetable,
    );
    return connection ? toTrainLeg(connection) : undefined;
  }

  if (outbound) {
    const to = await deps.geocoder.find(outbound.to);
    if (to) outbound.train = await connect(homeGrid, to.location, input.startDate, OUTBOUND_TIME);
  }
  if (back) {
    const from = await deps.geocoder.find(back.from);
    const [homeStation] = await deps.stations.near(homeGrid, HOME_STATION_RADIUS_KM);
    if (from && homeStation) {
      const connection = await findConnectionTo(
        {
          from: from.location,
          toStation: homeStation,
          departAfter: fromLocal(input.endDate, RETURN_TIME),
          regionalOnly,
        },
        deps.stations,
        deps.timetable,
      );
      if (connection) back.train = toTrainLeg(connection);
    }
  }
  return { ...plan, travel };
}
