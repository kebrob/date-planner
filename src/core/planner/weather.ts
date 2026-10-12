import type { WeatherHour } from '@/ports/weather';
import type { Activity, WeatherCondition, WeatherSummary } from './types';

const RELIABLE_DAYS = 7;
const RAIN_PROBABILITY_THRESHOLD = 40;
const RAIN_MM_THRESHOLD = 0.5;
const SNOW_CM_THRESHOLD = 0.5;
const CLEAR_SKY_MAX_CLOUD_PCT = 40;
const HOT_FROM_C = 27;
const COLD_UNTIL_C = 6;
const WINDY_FROM_KMH = 40;

/** Weather of the hours overlapping [start, end]; precipitation counts for the preceding hour. */
export function windowWeather(
  hours: WeatherHour[],
  start: Date,
  end: Date,
  reliability: WeatherSummary['reliability'],
): WeatherSummary {
  const inWindow = hours.filter(
    (h) => h.time >= new Date(start.getTime() - 3_600_000) && h.time <= end,
  );
  if (inWindow.length === 0) {
    return { reliability: 'none', dry: null, minTempC: null, maxTempC: null, conditions: [] };
  }
  const totalRain = inWindow.reduce((sum, h) => sum + h.precipitationMm, 0);
  const maxProbability = Math.max(...inWindow.map((h) => h.precipitationProbability ?? 0));
  const temps = inWindow.map((h) => h.temperatureC);
  const dry = totalRain < RAIN_MM_THRESHOLD && maxProbability < RAIN_PROBABILITY_THRESHOLD;
  const minTempC = Math.min(...temps);
  const maxTempC = Math.max(...temps);

  const known = (values: (number | null | undefined)[]) =>
    values.filter((v): v is number => typeof v === 'number');
  const clouds = known(inWindow.map((h) => h.cloudCoverPct));
  const wind = known(inWindow.map((h) => h.windKmh));
  const snow = known(inWindow.map((h) => h.snowfallCm)).reduce((sum, v) => sum + v, 0);

  const conditions: WeatherCondition[] = [];
  if (snow >= SNOW_CM_THRESHOLD) conditions.push('snow');
  else if (!dry) conditions.push('rain');
  if (
    dry &&
    clouds.length > 0 &&
    clouds.reduce((s, v) => s + v, 0) / clouds.length < CLEAR_SKY_MAX_CLOUD_PCT
  ) {
    conditions.push('sunny');
  }
  if (maxTempC >= HOT_FROM_C) conditions.push('hot');
  if (maxTempC <= COLD_UNTIL_C) conditions.push('cold');
  if (wind.length > 0 && Math.max(...wind) >= WINDY_FROM_KMH) conditions.push('windy');

  return { reliability, dry, minTempC, maxTempC, conditions };
}

export function summarizeWeather(
  hours: WeatherHour[],
  start: Date,
  end: Date,
  now: Date,
): WeatherSummary {
  const daysAhead = (start.getTime() - now.getTime()) / 86_400_000;
  return windowWeather(hours, start, end, daysAhead > RELIABLE_DAYS ? 'low' : 'good');
}

type WeatherRule = {
  when: WeatherCondition;
  tags?: string[];
  placeTypes?: string[];
  factor: number;
};

const SUNNY_SPOTS = [
  'beer_garden',
  'viewpoint',
  'park',
  'riverside',
  'bathing_lake',
  'mountain_hut',
];

/** Default weather preferences; learned per-condition tag weights from ratings come on top. */
export const WEATHER_PREFERENCES: WeatherRule[] = [
  { when: 'rain', tags: ['indoor', 'home'], factor: 1.5 },
  { when: 'rain', tags: ['outdoor'], factor: 0.4 },
  { when: 'snow', tags: ['indoor', 'home'], factor: 1.3 },
  { when: 'snow', tags: ['outdoor'], factor: 0.7 },
  { when: 'sunny', tags: ['outdoor'], factor: 1.5 },
  { when: 'sunny', tags: ['indoor'], factor: 0.75 },
  { when: 'sunny', placeTypes: SUNNY_SPOTS, factor: 1.3 },
  { when: 'hot', placeTypes: ['bathing_lake', 'swimming', 'ice_cream'], factor: 1.8 },
  { when: 'hot', tags: ['active'], factor: 0.7 },
  { when: 'cold', placeTypes: ['thermal_bath', 'cafe'], factor: 1.5 },
  { when: 'cold', tags: ['outdoor'], factor: 0.6 },
  { when: 'windy', tags: ['outdoor'], factor: 0.8 },
];

/** Multiplier for an activity's score under the given conditions (1 = neutral). */
export function weatherFactor(activity: Activity, conditions: WeatherCondition[]): number {
  return WEATHER_PREFERENCES.reduce((factor, rule) => {
    if (!conditions.includes(rule.when)) return factor;
    const matches =
      rule.tags?.some((t) => activity.tags.includes(t)) ||
      (activity.placeType !== null && rule.placeTypes?.includes(activity.placeType));
    return matches ? factor * rule.factor : factor;
  }, 1);
}

/** Why a planned item may no longer suit the weather; null when it does. */
export function weatherConcern(
  activity: Pick<Activity, 'tags' | 'weather' | 'atHome'>,
  weather: WeatherSummary,
): 'rain' | 'snow' | 'cold' | 'hot' | null {
  if (weather.reliability === 'none' || activity.atHome) return null;
  const req = activity.weather;
  const outdoor = activity.tags.includes('outdoor');
  const conditions = weather.conditions ?? [];
  if (conditions.includes('snow') && (outdoor || req.dryOnly)) return 'snow';
  if (weather.dry === false && (outdoor || req.dryOnly)) return 'rain';
  if (req.minTempC !== undefined && weather.minTempC !== null && weather.minTempC < req.minTempC)
    return 'cold';
  if (req.maxTempC !== undefined && weather.maxTempC !== null && weather.maxTempC > req.maxTempC)
    return 'hot';
  return null;
}
