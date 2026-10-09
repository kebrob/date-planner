import type { LatLng } from './places';

export type WeatherHour = {
  time: Date;
  temperatureC: number;
  precipitationProbability: number | null;
  precipitationMm: number;
};

export interface WeatherProvider {
  /** Hourly forecast covering [from, to]; empty when the range is beyond the forecast horizon. */
  hourly(location: LatLng, from: Date, to: Date): Promise<WeatherHour[]>;
}
