import { describe, expect, it } from 'vitest';
import { sunsetAt } from './sun';
import { fromLocal, toLocalTime } from './time';

const ROSENHEIM = { lat: 47.86, lng: 12.12 };

describe('sunsetAt', () => {
  it.each([
    ['2026-10-09', '18:33', '18:45'],
    ['2026-06-21', '21:05', '21:20'],
    ['2026-12-21', '16:15', '16:30'],
  ])('is plausible for Rosenheim on %s', (date, earliest, latest) => {
    const sunset = sunsetAt(fromLocal(date, '12:00'), ROSENHEIM)!;
    expect(toLocalTime(sunset) >= earliest && toLocalTime(sunset) <= latest).toBe(true);
  });

  it('returns null during polar day', () => {
    expect(sunsetAt(fromLocal('2026-06-21', '12:00'), { lat: 78.2, lng: 15.6 })).toBeNull();
  });
});
