import type { LatLng } from './places';

export type WeatherHour = {
  time: Date;
  temperatureC: number;
  precipitationProbability: number | null;
  precipitationMm: number;
  /** Optional so that hours stored before these fields existed stay valid. */
  cloudCoverPct?: number | null;
  windKmh?: number | null;
  snowfallCm?: number | null;
};

export interface WeatherProvider {
  /**
   * Hourly data covering [from, to]: forecast up to the horizon, recent past for rating context.
   * Empty when the range is out of reach.
   */
  hourly(location: LatLng, from: Date, to: Date): Promise<WeatherHour[]>;
}
