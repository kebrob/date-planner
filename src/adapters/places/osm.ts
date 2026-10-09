import type { PlaceType } from '@/ports/place-types';
import type { Place, PlaceSearch, PlacesProvider } from '@/ports/places';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// The public Overpass instance is often slow or rate-limited; fail fast and let a fallback answer.
const TIMEOUT_MS = 4_000;
// Large "around" areas make Overpass queries slow; free ideas are only searched nearby anyway.
const MAX_RADIUS_KM = 15;

// Provider-neutral place type → OSM tag filters (any filter may match).
export const OSM_FILTERS: Record<PlaceType, string[]> = {
  miniature_golf: ['["leisure"="miniature_golf"]'],
  cinema: ['["amenity"="cinema"]'],
  bowling: ['["leisure"="bowling_alley"]'],
  museum: ['["tourism"="museum"]'],
  gallery: ['["tourism"="gallery"]'],
  theatre: ['["amenity"="theatre"]'],
  restaurant: ['["amenity"="restaurant"]'],
  cafe: ['["amenity"="cafe"]'],
  ice_cream: ['["amenity"="ice_cream"]', '["cuisine"="ice_cream"]'],
  bar: ['["amenity"="bar"]', '["amenity"="pub"]'],
  beer_garden: ['["amenity"="biergarten"]', '["beer_garden"="yes"]'],
  climbing: ['["sport"="climbing"]["leisure"~"sports_centre|sports_hall"]'],
  swimming: ['["leisure"="water_park"]', '["leisure"="sports_centre"]["sport"="swimming"]'],
  thermal_bath: ['["amenity"="public_bath"]', '["leisure"="water_park"]'],
  bathing_lake: ['["leisure"="bathing_place"]'],
  escape_room: ['["leisure"="escape_game"]'],
  zoo: ['["tourism"="zoo"]'],
  theme_park: ['["tourism"="theme_park"]'],
  ice_rink: ['["leisure"="ice_rink"]'],
  karting: ['["sport"="karting"]'],
  trampoline: ['["leisure"="trampoline_park"]'],
  viewpoint: ['["tourism"="viewpoint"]'],
  park: ['["leisure"="park"]'],
  riverside: ['["waterway"="river"]'],
  library: ['["amenity"="library"]'],
  bookshop: ['["shop"="books"]'],
  church: ['["amenity"="place_of_worship"]["religion"="christian"]["building"~"cathedral|church"]'],
  marketplace: ['["amenity"="marketplace"]'],
  mall: ['["shop"="mall"]'],
  mountain_hut: ['["tourism"="alpine_hut"]'],
};

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function buildQuery(request: PlaceSearch): string | null {
  const filters = OSM_FILTERS[request.placeType as PlaceType] as string[] | undefined;
  if (!filters) return null;
  const radiusM = Math.round(Math.min(request.radiusKm, MAX_RADIUS_KM) * 1000);
  const around = `(around:${radiusM},${request.center.lat},${request.center.lng})`;
  const parts = filters.map((f) => `nwr${f}["name"]${around};`).join('');
  return `[out:json][timeout:4];(${parts});out center tags ${request.maxResults};`;
}

export class OsmPlacesProvider implements PlacesProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async search(request: PlaceSearch): Promise<Place[]> {
    const query = buildQuery(request);
    if (!query) return [];
    const res = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'User-Agent': 'date-planner (private)',
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
    const body = (await res.json()) as { elements?: OsmElement[] };
    return (body.elements ?? []).flatMap((e): Place[] => {
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      const name = e.tags?.name;
      if (lat === undefined || lng === undefined || !name) return [];
      return [
        {
          provider: 'osm',
          id: `${e.type}/${e.id}`,
          name,
          location: { lat, lng },
          address:
            [e.tags?.['addr:street'], e.tags?.['addr:housenumber'], e.tags?.['addr:city']]
              .filter(Boolean)
              .join(' ') || undefined,
          // OSM opening_hours syntax is too varied to evaluate reliably; only the trivial case is used.
          openingHours: e.tags?.opening_hours === '24/7' ? { alwaysOpen: true } : null,
        },
      ];
    });
  }
}
