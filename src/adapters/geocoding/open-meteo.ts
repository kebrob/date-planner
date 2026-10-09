import type { GeoArea, GeocodingProvider } from '@/ports/geocoding';

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 10_000;

type Result = { name: string; latitude: number; longitude: number; admin1?: string };

/** Free, keyless geocoding (GeoNames data; attribution shown in the app footer). */
export class OpenMeteoGeocoder implements GeocodingProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async find(query: string): Promise<GeoArea | null> {
    const params = new URLSearchParams({
      name: query.trim(),
      count: '1',
      language: 'de',
      countryCode: 'DE',
      format: 'json',
    });
    const res = await this.fetchFn(`${ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Open-Meteo geocoding responded ${res.status}`);
    const body = (await res.json()) as { results?: Result[] };
    const hit = body.results?.[0];
    if (!hit) return null;
    return {
      name: hit.admin1 ? `${hit.name}, ${hit.admin1}` : hit.name,
      location: { lat: hit.latitude, lng: hit.longitude },
    };
  }
}
