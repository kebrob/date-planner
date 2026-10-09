import { estimateTravel } from '@/core/planner/geo';
import type { Plan, PlanItem, Transport, Travel, TravelRoutine } from '@/core/planner/types';
import { addMinutes, minutesBetween } from '@/lib/time';
import type { LatLng } from '@/ports/places';
import type { RailStationFinder, RailTimetable } from '@/ports/rail';
import { findConnection, findConnectionTo, toTrainLeg } from '@/rail/connection';

const STATION_RADIUS_KM = 2;
const MAX_ORIGIN_STATIONS = 3;
// Arriving home this much after the planned end still counts as on time.
const LATE_RETURN_TOLERANCE_MIN = 15;

export type TrainContext = {
  start: Date;
  end: Date;
  transport: Transport;
  /** Exact home (pin) for local walking times; never sent anywhere. */
  home: LatLng;
  /** Rounded home, the only home location used for station lookups. */
  homeGrid: LatLng;
  routine?: TravelRoutine;
  /** Set when the date starts in the chosen area instead of at home. */
  startPoint?: LatLng;
};

type Rail = { stations: RailStationFinder; timetable: RailTimetable };

function shiftFrom(items: PlanItem[], index: number, minutes: number) {
  for (const item of items.slice(index)) {
    item.start = addMinutes(item.start, minutes);
    item.end = addMinutes(item.end, minutes);
  }
}

/** Minutes between home and its station: the travel routine if there is one, else on foot. */
function homeAccess(ctx: TrainContext, station: LatLng): number {
  return ctx.routine
    ? ctx.routine.firstLegMinutes + ctx.routine.bufferMinutes
    : estimateTravel(ctx.home, station, 'walk', undefined).minutes;
}

const localAccess = (from: LatLng, to: LatLng) =>
  estimateTravel(from, to, 'deutschlandticket', undefined).minutes;

/**
 * Replaces estimated train legs with real direct trains and moves later items if a train
 * arrives later than estimated. Legs without a fitting train keep their estimate.
 */
export async function attachTrains(plan: Plan, ctx: TrainContext, rail: Rail): Promise<void> {
  const regionalOnly = ctx.transport === 'deutschlandticket';
  const warnings = new Set(plan.warnings);

  async function connect(
    from: LatLng,
    fromIsHome: boolean,
    to: LatLng,
    toIsHome: boolean,
    readyAt: Date,
  ) {
    // The closest station may be an S-Bahn halt without a direct train, so try a few.
    const origins = (
      await rail.stations.near(fromIsHome ? ctx.homeGrid : from, STATION_RADIUS_KM)
    ).slice(0, MAX_ORIGIN_STATIONS);
    const attempt = async (regional: boolean) => {
      for (const station of origins) {
        const access = fromIsHome
          ? homeAccess(ctx, station.location)
          : localAccess(from, station.location);
        const connection = await findConnection(
          {
            from: fromIsHome ? ctx.homeGrid : from,
            to: toIsHome ? ctx.homeGrid : to,
            departAfter: addMinutes(readyAt, access),
            regionalOnly: regional,
            fromStation: station,
          },
          rail.stations,
          rail.timetable,
        );
        if (connection) return { connection, access };
      }
      return null;
    };
    // Home-bound: search from the home station's arrivals, which finds the right city station.
    const attemptHome = async (regional: boolean) => {
      const [homeStation] = await rail.stations.near(ctx.homeGrid, STATION_RADIUS_KM);
      if (!homeStation) return null;
      const connection = await findConnectionTo(
        { from, toStation: homeStation, departAfter: readyAt, regionalOnly: regional },
        rail.stations,
        rail.timetable,
      );
      return connection
        ? { connection, access: localAccess(from, connection.from.location) }
        : null;
    };
    const search = toIsHome && !fromIsHome ? attemptHome : attempt;
    let found = await search(regionalOnly);
    if (!found && regionalOnly) {
      found = await search(false);
      if (found) warnings.add('train_ticket_needed');
    }
    if (!found) return null;
    const { connection, access } = found;
    const egress = toIsHome
      ? homeAccess(ctx, connection.to.location)
      : localAccess(connection.to.location, to);
    // Planned time: a delay may shrink again, and then the train would be gone.
    const leaveAt = addMinutes(connection.departure.planned, -access);
    const arriveAt = addMinutes(connection.arrival.actual, egress);
    const travel = (estimate: Travel): Travel => ({
      ...estimate,
      minutes: minutesBetween(leaveAt, arriveAt),
      train: toTrainLeg(connection, leaveAt),
    });
    return { travel, arriveAt };
  }

  let here = ctx.startPoint ?? ctx.home;
  let hereIsHome = !ctx.startPoint;
  let readyAt = ctx.start;
  for (const [index, item] of plan.items.entries()) {
    const target = item.activity.atHome ? ctx.home : item.place?.location;
    if (item.travelBefore?.mode === 'train' && target) {
      const result = await connect(here, hereIsHome, target, item.activity.atHome, readyAt);
      if (result) {
        item.travelBefore = result.travel(item.travelBefore);
        const late = minutesBetween(item.start, result.arriveAt);
        if (late > 0) {
          shiftFrom(plan.items, index, late);
          warnings.add('train_times_adjusted');
        }
      }
    }
    if (target) {
      here = target;
      hereIsHome = item.activity.atHome;
    }
    readyAt = item.end;
  }

  if (plan.travelHome?.mode === 'train' && !hereIsHome) {
    const result = await connect(here, false, ctx.home, true, readyAt);
    if (result) {
      plan.travelHome = result.travel(plan.travelHome);
      if (minutesBetween(ctx.end, result.arriveAt) > LATE_RETURN_TOLERANCE_MIN) {
        warnings.add('train_late_return');
      }
    }
  }
  plan.warnings = [...warnings];
}
