import type { WeatherHour } from '@/ports/weather';
import type { WeatherSummary } from './types';

const RELIABLE_DAYS = 7;
const RAIN_PROBABILITY_THRESHOLD = 40;
const RAIN_MM_THRESHOLD = 0.5;

export function summarizeWeather(
  hours: WeatherHour[],
  start: Date,
  end: Date,
  now: Date,
): WeatherSummary {
  const inWindow = hours.filter(
    (h) => h.time >= new Date(start.getTime() - 3_600_000) && h.time <= end,
  );
  if (inWindow.length === 0) {
    return { reliability: 'none', dry: null, minTempC: null, maxTempC: null };
  }
  const daysAhead = (start.getTime() - now.getTime()) / 86_400_000;
  const totalRain = inWindow.reduce((sum, h) => sum + h.precipitationMm, 0);
  const maxProbability = Math.max(...inWindow.map((h) => h.precipitationProbability ?? 0));
  const temps = inWindow.map((h) => h.temperatureC);
  return {
    reliability: daysAhead > RELIABLE_DAYS ? 'low' : 'good',
    dry: totalRain < RAIN_MM_THRESHOLD && maxProbability < RAIN_PROBABILITY_THRESHOLD,
    minTempC: Math.min(...temps),
    maxTempC: Math.max(...temps),
  };
}
