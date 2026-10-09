import type { CostGuard } from '@/guard/guard';
import type { OpeningHours, Place, PlaceSearch, PlacesProvider } from '@/ports/places';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
// Rating and opening hours put this request into the Text Search Enterprise SKU (1,000 free/month).
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.rating',
  'places.regularOpeningHours',
].join(',');
const MAX_BIAS_RADIUS_M = 50_000;
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
};

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

export class GooglePlacesProvider implements PlacesProvider {
  constructor(
    private readonly apiKey: string,
    private readonly guard: CostGuard,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async search(request: PlaceSearch): Promise<Place[]> {
    return this.guard.run('google_places', 0, async () => {
      const res = await this.fetchFn(ENDPOINT, {
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
          locationBias: {
            circle: {
              center: { latitude: request.center.lat, longitude: request.center.lng },
              radius: Math.min(request.radiusKm * 1000, MAX_BIAS_RADIUS_M),
            },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Google Places responded ${res.status}`);
      const body = (await res.json()) as { places?: GooglePlace[] };
      const places = (body.places ?? [])
        .filter((p) => p.location && p.displayName?.text)
        .map((p): Place => ({
          provider: 'google',
          id: p.id,
          name: p.displayName!.text!,
          location: { lat: p.location!.latitude, lng: p.location!.longitude },
          address: p.formattedAddress,
          rating: p.rating,
          openingHours: parseOpeningHours(p.regularOpeningHours),
          mapsUrl: p.googleMapsUri,
        }));
      return { result: places, actualCostUsd: 0 };
    });
  }
}
