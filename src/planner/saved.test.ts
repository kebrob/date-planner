import { describe, expect, it } from 'vitest';
import type { Place } from '@/ports/places';
import { archivedPlace, isFullPlace, rowsToView } from './saved';

const googlePlace: Place = {
  provider: 'google',
  id: 'g1',
  name: 'Ruff’s Burger',
  location: { lat: 48.13, lng: 11.57 },
  address: 'Müllerstraße 1, München',
  rating: 4.5,
  openingHours: { alwaysOpen: true },
  mapsUrl: 'https://maps.google.com/?cid=1',
};
const osmPlace: Place = { ...googlePlace, provider: 'osm', id: 'node/1' };

describe('archivedPlace', () => {
  it('keeps only id and name of Google places', () => {
    const archived = archivedPlace(googlePlace);
    expect(archived).toEqual({
      provider: 'google',
      id: 'g1',
      name: 'Ruff’s Burger',
      archived: true,
    });
    expect(isFullPlace(archived)).toBe(false);
  });

  it('keeps OpenStreetMap places as they are', () => {
    expect(archivedPlace(osmPlace)).toBe(osmPlace);
  });
});

describe('rowsToView', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const plan = {
    id: 'p1',
    startsAt: new Date('2026-10-10T08:00:00Z'),
    endsAt: new Date('2026-10-10T18:00:00Z'),
    parameters: { date: '2026-10-10', startTime: '10:00', endDate: '2026-10-10', endTime: '22:00' },
    weather: null,
    totalCostEur: 40,
    overBudgetEur: 0,
    status: 'accepted' as const,
    isFavorite: true,
    note: 'Table at 19:00',
    areaName: 'München, Bayern',
    travelHome: null,
    createdAt: now,
    updatedAt: now,
  };
  const item = {
    id: 'i1',
    planId: 'p1',
    position: 0,
    activityId: 'a1',
    startsAt: new Date('2026-10-10T08:00:00Z'),
    endsAt: new Date('2026-10-10T09:30:00Z'),
    title: 'Burgers',
    slot: 'meal',
    preparation: null,
    atHome: false,
    openingHoursUnknown: false,
    placeProvider: 'google',
    placeId: 'g1',
    placeName: 'Ruff’s Burger',
    place: archivedPlace(googlePlace),
    alternatives: [],
    costEur: 30,
    travel: null,
  };

  it('shows the stored name for archived places and marks past plans', () => {
    const view = rowsToView(plan, [item], now);
    expect(view.isPast).toBe(true);
    expect(view.items[0]).toMatchObject({ place: null, placeName: 'Ruff’s Burger', slot: 'meal' });
    expect(view.window).toEqual({
      date: '2026-10-10',
      startTime: '10:00',
      endDate: '2026-10-10',
      endTime: '22:00',
    });
    expect(view.weather.reliability).toBe('none');
  });

  it('returns the full place for upcoming plans', () => {
    const view = rowsToView(plan, [{ ...item, place: googlePlace }], new Date('2026-10-01'));
    expect(view.isPast).toBe(false);
    expect(view.items[0]!.place).toEqual(googlePlace);
  });
});
