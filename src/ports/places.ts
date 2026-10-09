export type LatLng = { lat: number; lng: number };

/** Weekly opening periods in minutes since Sunday 00:00 local time; `end` may exceed one week. */
export type OpeningHours =
  { alwaysOpen: true } | { alwaysOpen: false; periods: { start: number; end: number }[] };

export type Place = {
  provider: 'google' | 'osm';
  id: string;
  name: string;
  location: LatLng;
  address?: string;
  rating?: number;
  /** null when the provider has no (parseable) opening hours. */
  openingHours: OpeningHours | null;
  mapsUrl?: string;
  website?: string;
  /** Typical spend per person in euros (restaurants, cafés); max null = open-ended. */
  pricePerPerson?: { min: number; max: number | null };
};

export type PlaceSearch = {
  /** Provider-neutral type, e.g. "miniature_golf". */
  placeType: string;
  /** Free-text query for providers with text search, e.g. "Minigolf". */
  query: string;
  center: LatLng;
  radiusKm: number;
  maxResults: number;
  /** Free ideas (parks, libraries …) where opening hours and ratings matter less. */
  free?: boolean;
};

export interface PlacesProvider {
  search(request: PlaceSearch): Promise<Place[]>;
}

/** Re-fetches full data for a stored place id (used when re-planning archived plans). */
export interface PlaceDetailsProvider {
  details(id: string): Promise<Place | null>;
}
