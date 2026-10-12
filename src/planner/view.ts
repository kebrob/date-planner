import { MAX_ITEMS } from '@/core/planner/types';
import type {
  Plan,
  PlanWarning,
  Slot,
  TrainLeg,
  Travel,
  TravelMode,
  WeatherSummary,
} from '@/core/planner/types';
import { toLocalDate, toLocalTime } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';

export type Leg = Travel & {
  from: string;
  to: string;
  directionsUrl: string | null;
  /** Connection search on bahn.de for a real train. */
  trainUrl: string | null;
};

/** Serializable plan for client components (dates as ISO strings). */
export type PlanView = {
  format: Plan['format'];
  area: string | null;
  items: {
    slot: Slot;
    activityId: string;
    title: string;
    description: string;
    preparation: string | null;
    atHome: boolean;
    place: Place | null;
    /** Kept when full place data was removed after the date (archived plans). */
    placeName: string | null;
    /** Where an idea without a venue happens, e.g. "Near home" for a walk. */
    locationHint: string | null;
    alternatives: Place[];
    travelBefore: Leg | null;
    start: string;
    end: string;
    costEur: number;
    openingHoursUnknown: boolean;
  }[];
  travelHome: Leg | null;
  totalCostEur: number;
  overBudgetEur: number;
  weather: WeatherSummary;
  warnings: PlanWarning[];
};

const TRAVEL_MODE: Record<TravelMode, string> = {
  walk: 'walking',
  bike: 'bicycling',
  car: 'driving',
  local_transit: 'transit',
  train: 'transit',
};

type Point = { name: string; location: LatLng; place?: Place };

function directionsUrl(from: Point, to: Point, mode: TravelMode): string {
  const params = new URLSearchParams({
    api: '1',
    origin: `${from.location.lat},${from.location.lng}`,
    destination:
      to.place?.address != null
        ? `${to.place.name}, ${to.place.address}`
        : `${to.location.lat},${to.location.lng}`,
    travelmode: TRAVEL_MODE[mode],
  });
  if (to.place?.provider === 'google') params.set('destination_place_id', to.place.id);
  return `https://www.google.com/maps/dir/?${params}`;
}

/**
 * Opens the connection search on bahn.de (and the DB Navigator app where it handles the link),
 * up to the final station when the leg includes a change.
 */
export function trainUrl(train: TrainLeg, transfers: TrainLeg[] = []): string {
  const station = (eva: string) => `A=1@L=${eva}`;
  const departure = toLocalDate(new Date(train.plannedDeparture));
  const time = toLocalTime(new Date(train.plannedDeparture));
  const to = transfers.at(-1)?.to ?? train.to;
  const params = new URLSearchParams({
    sts: 'true',
    so: train.from.name,
    zo: to.name,
    soid: station(train.from.eva),
    zoid: station(to.eva),
    hd: `${departure}T${time}:00`,
    hza: 'D',
    kl: '2',
  });
  return `https://www.bahn.de/buchung/fahrplan/suche#${params}`;
}

function leg(travel: Travel | null, from: Point, to: Point): Leg | null {
  if (!travel) return null;
  return {
    ...travel,
    from: from.name,
    to: to.name,
    directionsUrl: directionsUrl(from, to, travel.mode),
    trainUrl: travel.train ? trainUrl(travel.train, travel.transfers) : null,
  };
}

export function toPlanView(
  plan: Plan,
  home: LatLng,
  area: { name: string; location: LatLng } | null,
): PlanView {
  const homePoint: Point = { name: 'Home', location: home };
  let previous: Point =
    plan.startsInArea && area ? { name: area.name, location: area.location } : homePoint;
  const items = plan.items.map((item) => {
    const here: Point = item.activity.atHome
      ? homePoint
      : item.place
        ? { name: item.place.name, location: item.place.location, place: item.place }
        : previous === homePoint && area
          ? { name: area.name, location: area.location }
          : previous;
    const view = {
      slot: item.slot,
      activityId: item.activity.id,
      title: item.activity.title,
      description: item.activity.description,
      preparation: item.activity.preparation,
      atHome: item.activity.atHome,
      place: item.place,
      placeName: item.place?.name ?? null,
      locationHint:
        item.activity.atHome || item.place
          ? null
          : here === homePoint
            ? 'Near home'
            : `Near ${here.name.split(',')[0]}`,
      alternatives: item.alternatives,
      travelBefore: leg(item.travelBefore, previous, here),
      start: item.start.toISOString(),
      end: item.end.toISOString(),
      costEur: item.costEur,
      openingHoursUnknown: item.openingHoursUnknown,
    };
    previous = here;
    return view;
  });
  return {
    format: plan.format,
    area: area?.name ?? null,
    items,
    travelHome: leg(plan.travelHome, previous, homePoint),
    totalCostEur: plan.totalCostEur,
    overBudgetEur: plan.overBudgetEur,
    weather: plan.weather,
    warnings: plan.warnings,
  };
}

// A new stop needs time for itself and for getting there.
const MIN_GAP_MINUTES = 60;

type FreeGap = {
  /** Where a new stop would go: before the item at this index (or at the end). */
  position: number;
  minutes: number;
};

/** Free time between stops (and before the first / after the last) that could take another stop. */
export function freeGaps(plan: PlanView, start: Date, end: Date): FreeGap[] {
  if (plan.items.length >= MAX_ITEMS) return [];
  const gaps: FreeGap[] = [];
  let free = start;
  const add = (position: number, until: Date, travelMinutes: number) => {
    const minutes = Math.round((until.getTime() - free.getTime()) / 60_000) - travelMinutes;
    if (minutes >= MIN_GAP_MINUTES) gaps.push({ position, minutes });
  };
  plan.items.forEach((item, i) => {
    add(i, new Date(item.start), item.travelBefore?.minutes ?? 0);
    free = new Date(item.end);
  });
  add(plan.items.length, end, plan.travelHome?.minutes ?? 0);
  return gaps;
}
