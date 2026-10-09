import { describe, expect, it } from 'vitest';
import { fromLocal } from '@/lib/time';
import { nextOuting } from './outing';

const at = (time: string) => fromLocal('2026-10-09', time);

describe('nextOuting', () => {
  it.each([
    ['08:20', 'today', '2026-10-09', '10:00', '22:00'],
    ['13:05', 'today', '2026-10-09', '14:00', '22:00'],
    ['17:30', 'tonight', '2026-10-09', '18:00', '23:00'],
    ['20:10', 'tonight', '2026-10-09', '21:00', '02:00'],
    ['21:30', 'tomorrow', '2026-10-10', '18:00', '23:00'],
    ['00:30', 'today', '2026-10-09', '10:00', '22:00'],
  ])('at %s plans %s', (now, when, date, start, end) => {
    expect(nextOuting(at(now))).toMatchObject({ when, date, startTime: start, endTime: end });
  });
});
