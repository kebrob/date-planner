import { distanceKm } from '@/core/planner/geo';
import stations from '@/rail/stations.json';
import type { LatLng } from '@/ports/places';
import type { RailStation, RailStationFinder } from '@/ports/rail';

type Row = [eva: string, name: string, lat: number, lng: number];

const ALL: RailStation[] = (stations as Row[]).map(([eva, name, lat, lng]) => ({
  eva,
  name,
  location: { lat, lng },
}));

/** Nearest DB stations from the bundled StaDa list (npm run rail:stations); no network call. */
export class StationListFinder implements RailStationFinder {
  constructor(private readonly list: RailStation[] = ALL) {}

  async near(point: LatLng, radiusKm: number): Promise<RailStation[]> {
    return this.list
      .map((station) => ({ station, km: distanceKm(point, station.location) }))
      .filter((s) => s.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 8)
      .map((s) => s.station);
  }
}
