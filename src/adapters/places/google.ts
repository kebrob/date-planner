import type { CostGuard } from '@/guard/guard';
import { fetchJson } from '../http';
import type {
  OpeningHours,
  Place,
  PlaceDetailsProvider,
  PlaceSearch,
  PlacesProvider,
} from '@/ports/places';
import type { PlaceType } from '@/ports/place-types';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places/';
// Rating, opening hours, price range and website put this request into the Text Search Enterprise
// SKU (1,000 free/month).
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.rating',
  'places.regularOpeningHours',
  'places.priceRange',
  'places.websiteUri',
].join(',');
const TIMEOUT_MS = 10_000;
const WEEK = 7 * 24 * 60;

type GooglePoint = { day?: number; hour?: number; minute?: number };
type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  formattedAddress?: string;
  googleMapsUri?: string;
  rating?: number;
  regularOpeningHours?: { periods?: { open?: GooglePoint; close?: GooglePoint }[] };
  priceRange?: { startPrice?: GoogleMoney; endPrice?: GoogleMoney };
  websiteUri?: string;
};
type GoogleMoney = { currencyCode?: string; units?: string; nanos?: number };

const euros = (m: GoogleMoney | undefined) =>
  m?.currencyCode === 'EUR' && m.units !== undefined ? Number(m.units) : undefined;

/** Price per person in euros; an open-ended range ("more than 50 €") keeps only its start. */
export function parsePriceRange(raw: GooglePlace['priceRange']): Place['pricePerPerson'] {
  const min = euros(raw?.startPrice);
  if (min === undefined || !Number.isFinite(min)) return undefined;
  const max = euros(raw?.endPrice);
  return { min, max: max !== undefined && Number.isFinite(max) && max >= min ? max : null };
}

const toMinute = (p: GooglePoint) => (p.day ?? 0) * 1440 + (p.hour ?? 0) * 60 + (p.minute ?? 0);

export function parseOpeningHours(raw: GooglePlace['regularOpeningHours']): OpeningHours | null {
  const periods = raw?.periods;
  if (!periods || periods.length === 0) return null;
  // Always-open places have a single period without a close point.
  if (periods.length === 1 && periods[0]?.open && !periods[0].close) return { alwaysOpen: true };
  const parsed = periods
    .filter((p) => p.open && p.close)
    .map((p) => {
      const start = toMinute(p.open!);
      const end = toMinute(p.close!);
      return { start, end: end <= start ? end + WEEK : end };
    });
  return parsed.length > 0 ? { alwaysOpen: false, periods: parsed } : null;
}

// Neutral place type → Google "Table A" type. Without a match the text query alone decides
// (e.g. escape rooms, climbing gyms, thermal baths have no fitting Google type).
const GOOGLE_TYPES: Partial<Record<PlaceType, string>> = {
  miniature_golf: 'miniature_golf_course',
  cinema: 'movie_theater',
  bowling: 'bowling_alley',
  museum: 'museum',
  gallery: 'art_gallery',
  theatre: 'performing_arts_theater',
  restaurant: 'restaurant',
  cafe: 'cafe',
  ice_cream: 'ice_cream_shop',
  bar: 'bar',
  beer_garden: 'beer_garden',
  swimming: 'swimming_pool',
  zoo: 'zoo',
  theme_park: 'amusement_park',
  ice_rink: 'ice_skating_rink',
  karting: 'go_karting_venue',
  park: 'park',
  library: 'library',
  bookshop: 'book_store',
  church: 'church',
  marketplace: 'market',
  mall: 'shopping_mall',
};

export function googleTypeFor(placeType: string): string | undefined {
  return GOOGLE_TYPES[placeType as PlaceType];
}

export function boundingBox(center: { lat: number; lng: number }, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  return {
    low: { latitude: center.lat - dLat, longitude: center.lng - dLng },
    high: { latitude: center.lat + dLat, longitude: center.lng + dLng },
  };
}

function toPlace(p: GooglePlace): Place | null {
  if (!p.location || !p.displayName?.text) return null;
  return {
    provider: 'google',
    id: p.id,
    name: p.displayName.text,
    location: { lat: p.location.latitude, lng: p.location.longitude },
    address: p.formattedAddress,
    rating: p.rating,
    openingHours: parseOpeningHours(p.regularOpeningHours),
    mapsUrl: p.googleMapsUri,
    website: p.websiteUri,
    pricePerPerson: parsePriceRange(p.priceRange),
  };
}

export class GooglePlacesProvider implements PlacesProvider, PlaceDetailsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly guard: CostGuard,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async search(request: PlaceSearch): Promise<Place[]> {
    return this.guard.run('google_places', 0, async () => {
      const body = await fetchJson<{ places?: GooglePlace[] }>(
        this.fetchFn,
        ENDPOINT,
        'Google Places',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery: request.query,
            pageSize: Math.min(request.maxResults, 20),
            languageCode: 'de',
            regionCode: 'DE',
            // Strict type filtering stops e.g. a skate park from answering a "Park" search.
            ...(googleTypeFor(request.placeType)
              ? { includedType: googleTypeFor(request.placeType), strictTypeFiltering: true }
              : {}),
            // A bias still returns famous places far outside the area; restrict to its bounding box.
            locationRestriction: { rectangle: boundingBox(request.center, request.radiusKm) },
          }),
          timeoutMs: TIMEOUT_MS,
        },
      );
      const places = (body.places ?? []).flatMap((p) => toPlace(p) ?? []);
      return { result: places, actualCostUsd: 0 };
    });
  }

  async details(id: string): Promise<Place | null> {
    if (!/^[\w-]+$/.test(id)) return null;
    return this.guard.run('google_places', 0, async () => {
      const place = await fetchJson<GooglePlace>(
        this.fetchFn,
        DETAILS_ENDPOINT + id,
        'Google Place Details',
        {
          headers: {
            'X-Goog-Api-Key': this.apiKey,
            // Same fields as the search, without the "places." prefix.
            'X-Goog-FieldMask': FIELD_MASK.replaceAll('places.', ''),
          },
          timeoutMs: TIMEOUT_MS,
        },
      );
      return { result: toPlace(place), actualCostUsd: 0 };
    });
  }
}
