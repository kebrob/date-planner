import { describe, expect, it } from 'vitest';
import type { Place } from '@/ports/places';
import { oneOffStop } from './edit';
import { isFullPlace, rowsToView } from './saved';
import { chosenStopSchema, customActivity } from './service';
import { freeGaps, type PlanView } from './view';

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

// What is left of a Google place after the date.
const archived = { provider: 'google', id: 'g1', name: 'Ruff’s Burger', archived: true };

describe('isFullPlace', () => {
  it('tells full places from archived ones', () => {
    expect(isFullPlace(googlePlace)).toBe(true);
    expect(isFullPlace(archived)).toBe(false);
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
    weatherPoint: null,
    travelHome: null,
    rating: null,
    notHappened: false,
    ratingPromptDismissed: false,
    trainsCheckedAt: null,
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
    place: archived,
    alternatives: [],
    costEur: 30,
    travel: null,
    rating: null,
    placeBlamed: false,
    weatherConditions: null,
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

  it('offers rating once the date has started, with item ratings in order', () => {
    const rated = rowsToView(
      { ...plan, rating: 'love' },
      [{ ...item, rating: 'dislike', placeBlamed: true }],
      now,
    );
    expect(rated).toMatchObject({
      canRate: true,
      rating: 'love',
      itemRatings: [{ rating: 'dislike', placeBlamed: true }],
    });
    expect(rowsToView(plan, [item], new Date('2026-10-01')).canRate).toBe(false);
  });

  it('returns the full place for upcoming plans', () => {
    const view = rowsToView(plan, [{ ...item, place: googlePlace }], new Date('2026-10-01'));
    expect(view.isPast).toBe(false);
    expect(view.items[0]!.place).toEqual(googlePlace);
  });
});

describe('chosen stops', () => {
  const row = {
    id: 'i1',
    planId: 'p1',
    position: 1,
    activityId: null,
    startsAt: new Date('2026-10-10T16:00:00Z'),
    endsAt: new Date('2026-10-10T17:30:00Z'),
    title: 'Ice skating',
    slot: 'main',
    preparation: null,
    atHome: false,
    openingHoursUnknown: false,
    placeProvider: 'google',
    placeId: 'g1',
    placeName: 'Eisstadion',
    place: googlePlace,
    alternatives: [],
    costEur: 24,
    travel: null,
    rating: null,
    placeBlamed: false,
    weatherConditions: null,
  };

  it('keeps one-off stops of saved plans by pinning them again', () => {
    expect(oneOffStop(row, 1)).toEqual({
      activityId: null,
      custom: {
        title: 'Ice skating',
        kind: 'activity',
        durationMinutes: 90,
        costEur: 24,
        query: 'Eisstadion',
      },
      place: googlePlace,
      startTime: null,
      index: 1,
    });
    // Stored ideas are kept as ideas; archived places can't be pinned.
    expect(oneOffStop({ ...row, activityId: 'a1' }, 1)).toBeNull();
    expect(oneOffStop({ ...row, place: archived }, 1)).toBeNull();
  });

  it('turns a one-off stop into a text-search idea of its kind', () => {
    const meal = customActivity('chosen-0', {
      title: 'Sushi',
      kind: 'meal',
      durationMinutes: 90,
      costEur: 60,
      query: 'Sushi',
    });
    expect(meal).toMatchObject({ category: 'food', tags: ['food', 'meal'], placeType: 'custom' });
  });

  it('needs either one of your ideas or a one-off stop', () => {
    const base = { place: null, startTime: null, index: null };
    expect(chosenStopSchema.safeParse({ ...base, activityId: null, custom: null }).success).toBe(
      false,
    );
    expect(
      chosenStopSchema.safeParse({
        ...base,
        activityId: '7f0f3c2e-1b2a-4c3d-9e8f-0a1b2c3d4e5f',
        custom: null,
      }).success,
    ).toBe(true);
  });
});

describe('freeGaps', () => {
  const at = (time: string) => new Date(`2026-10-17T${time}:00Z`);
  const item = (start: string, end: string, travel: number | null) =>
    ({
      start: at(start).toISOString(),
      end: at(end).toISOString(),
      travelBefore: travel === null ? null : { minutes: travel },
    }) as PlanView['items'][number];
  const plan = (items: PlanView['items'], home: number | null) =>
    ({ items, travelHome: home === null ? null : { minutes: home } }) as PlanView;

  it('finds room before, between and after stops, net of the way there', () => {
    const view = plan(
      [item('13:30', '15:00', 20), item('17:00', '18:00', 30), item('18:10', '19:00', 0)],
      30,
    );
    expect(freeGaps(view, at('13:00'), at('22:00'))).toEqual([
      { position: 1, minutes: 90 },
      { position: 3, minutes: 150 },
    ]);
  });

  it('offers nothing once the plan has the maximum number of stops', () => {
    const five = Array.from({ length: 5 }, (_, i) => item(`1${i}:00`, `1${i}:30`, 0));
    expect(freeGaps(plan(five, 0), at('09:00'), at('23:00'))).toEqual([]);
  });
});
