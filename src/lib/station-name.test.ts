import { describe, expect, it } from 'vitest';
import { normalizeStationName } from './station-name';

describe('normalizeStationName', () => {
  it('matches spelling variants of the same station', () => {
    expect(normalizeStationName('München Hauptbahnhof')).toBe(normalizeStationName('München Hbf'));
    expect(normalizeStationName('Rosenheim (Bahnhof)')).toBe(normalizeStationName('Rosenheim'));
  });
});
