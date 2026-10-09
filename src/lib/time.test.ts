import { describe, expect, it } from 'vitest';
import { fromLocal, localParts, toLocalDate, toLocalTime } from './time';

describe('time', () => {
  it('converts Berlin summer time (UTC+2)', () => {
    expect(fromLocal('2026-07-10', '17:30').toISOString()).toBe('2026-07-10T15:30:00.000Z');
  });

  it('converts Berlin winter time (UTC+1)', () => {
    expect(fromLocal('2026-12-24', '18:00').toISOString()).toBe('2026-12-24T17:00:00.000Z');
  });

  it('handles the day after the DST switch', () => {
    expect(fromLocal('2026-10-25', '12:00').toISOString()).toBe('2026-10-25T11:00:00.000Z');
  });

  it('round-trips local date and time', () => {
    const d = fromLocal('2026-10-10', '09:05');
    expect(toLocalDate(d)).toBe('2026-10-10');
    expect(toLocalTime(d)).toBe('09:05');
  });

  it('returns the weekday with 0 = Sunday', () => {
    expect(localParts(fromLocal('2026-10-11', '10:00')).weekday).toBe(0);
    expect(localParts(fromLocal('2026-10-10', '10:00')).weekday).toBe(6);
  });

  it('rejects malformed input', () => {
    expect(() => fromLocal('2026-10', '10:00')).toThrow();
  });
});
