import type {
  Plan,
  PlanWarning,
  Slot,
  Travel,
  TravelMode,
  WeatherSummary,
} from '@/core/planner/types';
import type { LatLng, Place } from '@/ports/places';

export type Leg = Travel & { from: string; to: string; directionsUrl: string | null };

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

export function directionsUrl(from: Point, to: Point, mode: TravelMode): string {
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

function leg(travel: Travel | null, from: Point, to: Point): Leg | null {
  if (!travel) return null;
  return {
    ...travel,
    from: from.name,
    to: to.name,
    directionsUrl: directionsUrl(from, to, travel.mode),
  };
}

export function toPlanView(
  plan: Plan,
  home: LatLng,
  area: { name: string; location: LatLng } | null,
): PlanView {
  const homePoint: Point = { name: 'Home', location: home };
  let previous = homePoint;
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
