import type { LatLng } from '@/ports/places';
import type { Transport, Travel, TravelMode, TravelRoutine } from './types';

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Rough door-to-door estimates; straight-line distance is multiplied by a detour factor.
// Rail lines are fairly straight, so trains get a smaller detour factor than roads and paths.
const MODES: Record<
  TravelMode,
  { kmh: number; overheadMin: number; eurPerKm: number; detour: number }
> = {
  walk: { kmh: 4.5, overheadMin: 0, eurPerKm: 0, detour: 1.3 },
  bike: { kmh: 15, overheadMin: 5, eurPerKm: 0, detour: 1.3 },
  car: { kmh: 55, overheadMin: 10, eurPerKm: 0.2, detour: 1.3 },
  local_transit: { kmh: 20, overheadMin: 10, eurPerKm: 0, detour: 1.3 },
  train: { kmh: 80, overheadMin: 20, eurPerKm: 0, detour: 1.1 },
};
const MAX_KM: Record<Transport, number> = {
  walk: 4,
  bike: 20,
  car: Infinity,
  deutschlandticket: Infinity,
};
// Short hops are walked regardless of the chosen transport (parking/waiting takes longer).
const WALKABLE_KM = 1.2;
const LOCAL_TRANSIT_KM = 25;

export function maxDistanceKm(transport: Transport): number {
  return MAX_KM[transport];
}

function modeFor(transport: Transport, km: number): TravelMode {
  if (transport === 'bike') return 'bike';
  if (km < WALKABLE_KM || transport === 'walk') return 'walk';
  if (transport === 'car') return 'car';
  return km < LOCAL_TRANSIT_KM ? 'local_transit' : 'train';
}

/** `routine` applies only to legs leaving from home (e.g. driving to the station first). */
export function estimateTravel(
  from: LatLng,
  to: LatLng,
  transport: Transport,
  routine: TravelRoutine | undefined,
): Travel {
  const straightKm = distanceKm(from, to);
  // Mode thresholds use road distance; the chosen mode then applies its own detour.
  const mode = modeFor(transport, straightKm * MODES.car.detour);
  const m = MODES[mode];
  const km = straightKm * m.detour;
  const routineMin =
    routine && mode !== 'walk' ? routine.firstLegMinutes + routine.bufferMinutes : 0;
  return {
    minutes: Math.ceil((km / m.kmh) * 60 + m.overheadMin + routineMin),
    distanceKm: Math.round(km * 10) / 10,
    mode,
    costEur: Math.round(km * m.eurPerKm),
  };
}
