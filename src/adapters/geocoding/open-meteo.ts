import type { GeoArea, GeocodingProvider } from '@/ports/geocoding';
import { fetchJson } from '../http';

const ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 10_000;

type Result = {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  /** GeoNames feature code; towns are PPL*, airports AIRP. */
  feature_code?: string;
};

// "Muenchen" → "München": the geocoder only knows the umlaut spelling.
const withUmlauts = (q: string) =>
  q
    .replace(/ae/g, 'ä')
    .replace(/oe/g, 'ö')
    .replace(/ue/g, 'ü')
    .replace(/Ae/g, 'Ä')
    .replace(/Oe/g, 'Ö')
    .replace(/Ue/g, 'Ü');

/** Free, keyless geocoding (GeoNames data; attribution shown in the app footer). */
export class OpenMeteoGeocoder implements GeocodingProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async find(query: string): Promise<GeoArea | null> {
    const hit =
      (await this.search(query)) ??
      (withUmlauts(query) !== query ? await this.search(withUmlauts(query)) : null);
    if (!hit) return null;
    return {
      name: hit.admin1 ? `${hit.name}, ${hit.admin1}` : hit.name,
      location: { lat: hit.latitude, lng: hit.longitude },
    };
  }

  private async search(query: string): Promise<Result | null> {
    const params = new URLSearchParams({
      name: query.trim(),
      count: '5',
      language: 'de',
      countryCode: 'DE',
      format: 'json',
    });
    const body = await fetchJson<{ results?: Result[] }>(
      this.fetchFn,
      `${ENDPOINT}?${params}`,
      'Open-Meteo geocoding',
      { timeoutMs: TIMEOUT_MS },
    );
    const results = body.results ?? [];
    // Prefer towns over e.g. the airport named after them ("Nuremberg").
    return results.find((r) => r.feature_code?.startsWith('PPL')) ?? results[0] ?? null;
  }
}
