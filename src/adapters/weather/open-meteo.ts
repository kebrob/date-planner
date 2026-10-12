import type { LatLng } from '@/ports/places';
import type { WeatherHour, WeatherProvider } from '@/ports/weather';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;
const HORIZON_DAYS = 16;
// The forecast endpoint also serves recent past days (max. 92); used for the weather of rated dates.
const PAST_DAYS = 90;

type Series = (number | null)[];
type Response = {
  hourly?: {
    time: string[];
    temperature_2m: Series;
    precipitation_probability: Series;
    precipitation: Series;
    cloud_cover?: Series;
    wind_speed_10m?: Series;
    snowfall?: Series;
  };
};

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

export class OpenMeteoProvider implements WeatherProvider {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async hourly(location: LatLng, from: Date, to: Date): Promise<WeatherHour[]> {
    const now = this.now();
    const horizon = new Date(now.getTime() + (HORIZON_DAYS - 1) * 86_400_000);
    const earliest = new Date(now.getTime() - PAST_DAYS * 86_400_000);
    if (from > horizon || to < earliest) return [];

    const params = new URLSearchParams({
      latitude: location.lat.toFixed(2),
      longitude: location.lng.toFixed(2),
      hourly:
        'temperature_2m,precipitation_probability,precipitation,cloud_cover,wind_speed_10m,snowfall',
      // Default timezone is GMT, so hourly times are UTC.
      start_date: utcDate(from < earliest ? earliest : from),
      end_date: utcDate(to > horizon ? horizon : to),
    });
    const res = await this.fetchFn(`${ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const { hourly } = (await res.json()) as Response;
    if (!hourly) return [];
    return hourly.time.flatMap((time, i): WeatherHour[] => {
      const temperatureC = hourly.temperature_2m[i];
      if (temperatureC === null || temperatureC === undefined) return [];
      return [
        {
          time: new Date(`${time}:00Z`),
          temperatureC,
          precipitationProbability: hourly.precipitation_probability[i] ?? null,
          precipitationMm: hourly.precipitation[i] ?? 0,
          cloudCoverPct: hourly.cloud_cover?.[i] ?? null,
          windKmh: hourly.wind_speed_10m?.[i] ?? null,
          snowfallCm: hourly.snowfall?.[i] ?? null,
        },
      ];
    });
  }
}
