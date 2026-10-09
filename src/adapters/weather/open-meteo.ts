import type { LatLng } from '@/ports/places';
import type { WeatherHour, WeatherProvider } from '@/ports/weather';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;
const HORIZON_DAYS = 16;

type Response = {
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
  };
};

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

export class OpenMeteoProvider implements WeatherProvider {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async hourly(location: LatLng, from: Date, to: Date): Promise<WeatherHour[]> {
    const horizon = new Date(this.now().getTime() + (HORIZON_DAYS - 1) * 86_400_000);
    if (from > horizon || to < this.now()) return [];

    const params = new URLSearchParams({
      latitude: location.lat.toFixed(2),
      longitude: location.lng.toFixed(2),
      hourly: 'temperature_2m,precipitation_probability,precipitation',
      // Default timezone is GMT, so hourly times are UTC.
      start_date: utcDate(from < this.now() ? this.now() : from),
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
        },
      ];
    });
  }
}
