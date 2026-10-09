import type { LatLng } from './places';

export type GeoArea = { name: string; location: LatLng };

export interface GeocodingProvider {
  find(query: string): Promise<GeoArea | null>;
}
