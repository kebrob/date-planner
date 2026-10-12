import { distanceKm } from '@/core/planner/geo';
import { normalizeStationName } from '@/lib/station-name';
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
  private byName: Map<string, RailStation> | undefined;

  constructor(private readonly list: RailStation[] = ALL) {}

  async named(name: string): Promise<RailStation | null> {
    this.byName ??= new Map(this.list.map((s) => [normalizeStationName(s.name), s]));
    return this.byName.get(normalizeStationName(name)) ?? null;
  }

  async near(point: LatLng, radiusKm: number): Promise<RailStation[]> {
    return this.list
      .map((station) => ({ station, km: distanceKm(point, station.location) }))
      .filter((s) => s.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, 8)
      .map((s) => s.station);
  }
}
