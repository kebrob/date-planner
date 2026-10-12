import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration', () => {
  it.each([
    [45, '45min'],
    [60, '1h'],
    [115, '1h 55min'],
    [120, '2h'],
    [0, '0min'],
  ])('formats %i minutes as %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});
