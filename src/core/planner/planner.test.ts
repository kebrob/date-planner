import { describe, expect, it, vi } from 'vitest';
import { fromLocal } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { buildPlan, FALLBACK_ACTIVITY } from './build-plan';
import { estimateTravel } from './geo';
import { isOpenDuring } from './opening-hours';
import { seededRandom } from './random';
import { formatFor, score } from './rules';
import type { Activity, PlanContext, PlanRequest } from './types';
import { summarizeWeather } from './weather';

const HOME = { lat: 47.86, lng: 12.13 };

function activity(overrides: Partial<Activity> & { id: string }): Activity {
  return {
    title: overrides.id,
    description: '',
    category: 'activity',
    tags: [],
    costMinEur: 0,
    costMaxEur: 0,
    durationMinutes: 90,
    weather: {},
    transports: [],
    atHome: false,
    placeType: null,
    placeQuery: null,
    timesOfDay: [],
    seasons: [],
    preparation: null,
    ...overrides,
  };
}

function place(id: string, km = 2, overrides: Partial<Place> = {}): Place {
  return {
    provider: 'google',
    id,
    name: id,
    location: { lat: HOME.lat + km / 111, lng: HOME.lng },
    rating: 4.5,
    openingHours: { alwaysOpen: true },
    ...overrides,
  };
}

const minigolf = activity({
  id: 'minigolf',
  tags: ['outdoor', 'active'],
  costMinEur: 10,
  costMaxEur: 20,
  placeType: 'miniature_golf',
  placeQuery: 'Minigolf',
  weather: { dryOnly: true },
});
const cinema = activity({
  id: 'cinema',
  tags: ['indoor', 'chill'],
  costMinEur: 20,
  costMaxEur: 30,
  durationMinutes: 150,
  placeType: 'cinema',
  placeQuery: 'Kino',
});
const boardGames = activity({
  id: 'board-games',
  tags: ['indoor', 'chill', 'home'],
  atHome: true,
  durationMinutes: 120,
});
const dinner = activity({
  id: 'dinner',
  category: 'food',
  tags: ['food', 'meal'],
  costMinEur: 40,
  costMaxEur: 60,
  durationMinutes: 90,
  placeType: 'restaurant',
  placeQuery: 'Restaurant',
});

const iceCream = activity({
  id: 'ice-cream',
  category: 'food',
  tags: ['food', 'snack'],
  costMinEur: 5,
  costMaxEur: 10,
  durationMinutes: 45,
  placeType: 'ice_cream',
  placeQuery: 'Eisdiele',
});

/** Place `km` north of `from`. */
function placeAt(from: LatLng, km: number, id: string): Place {
  return { ...place(id), location: { lat: from.lat + km / 111, lng: from.lng } };
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    start: fromLocal('2026-10-10', '17:00'),
    end: fromLocal('2026-10-10', '23:00'),
    budgetEur: 100,
    transport: 'car',
    preferences: [],
    excludeActivityIds: [],
    ...overrides,
  };
}

function context(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    home: HOME,
    maxRadiusKm: 80,
    routines: [],
    activities: [minigolf, cinema, boardGames, dinner, iceCream],
    history: { daysSinceSuggested: {}, daysSinceAccepted: {} },
    weather: { reliability: 'good', dry: true, minTempC: 12, maxTempC: 18 },
    tagWeights: {},
    maxPlaceLookups: 6,
    findPlaces: async (a, center) => [placeAt(center, 1, `${a.id}-place`)],
    random: seededRandom(42),
    ...overrides,
  };
}

describe('buildPlan', () => {
  it('builds an evening plan with an activity and a meal in sequence', async () => {
    const plan = await buildPlan(request({ food: 'meal' }), context());
    expect(plan.format).toBe('evening');
    expect([...plan.items.map((i) => i.slot)].sort()).toEqual(['main', 'meal']);
    expect(plan.items.map((i) => i.activity.id)).toContain('dinner');
    expect(plan.items[1]!.start.getTime()).toBeGreaterThanOrEqual(plan.items[0]!.end.getTime());
  });

  it('plans no food when asked to', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const plan = await buildPlan(
        request({ food: 'none' }),
        context({ random: seededRandom(seed) }),
      );
      expect(plan.items.every((i) => i.activity.category !== 'food')).toBe(true);
    }
  });

  it('plans a snack instead of a meal when asked to', async () => {
    const plan = await buildPlan(request({ food: 'snack' }), context());
    const food = plan.items.filter((i) => i.activity.category === 'food');
    expect(food.map((i) => i.activity.id)).toEqual(['ice-cream']);
  });

  it('warns when the requested food does not fit', async () => {
    const plan = await buildPlan(
      request({ food: 'meal', budgetEur: 30 }),
      context({ activities: [minigolf, dinner] }),
    );
    expect(plan.items.map((i) => i.activity.id)).not.toContain('dinner');
    expect(plan.warnings).toContain('food_skipped');
  });

  it('skips proper meals in auto mode on a small budget', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = await buildPlan(
        request({ budgetEur: 30 }),
        context({ random: seededRandom(seed) }),
      );
      expect(plan.items.map((i) => i.slot)).not.toContain('meal');
    }
  });

  it('keeps the whole schedule including the way home inside the time window', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const req = request();
      const plan = await buildPlan(req, context({ random: seededRandom(seed) }));
      const last = plan.items.at(-1)!;
      const arrivalHome = last.end.getTime() + (plan.travelHome?.minutes ?? 0) * 60_000;
      expect(plan.items[0]!.start.getTime()).toBeGreaterThanOrEqual(req.start.getTime());
      expect(arrivalHome).toBeLessThanOrEqual(req.end.getTime());
    }
  });

  it('never exceeds the budget', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = await buildPlan(
        request({ budgetEur: 45 }),
        context({ random: seededRandom(seed) }),
      );
      expect(plan.totalCostEur).toBeLessThanOrEqual(45);
    }
  });

  it('drops dry-only activities when it rains', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = await buildPlan(
        request(),
        context({
          weather: { reliability: 'good', dry: false, minTempC: 8, maxTempC: 10 },
          random: seededRandom(seed),
        }),
      );
      expect(plan.items.map((i) => i.activity.id)).not.toContain('minigolf');
    }
  });

  it('skips places that are closed during the slot', async () => {
    const closed = place('closed-cinema', 2, { openingHours: { alwaysOpen: false, periods: [] } });
    const plan = await buildPlan(
      request({ format: 'single' }),
      context({ activities: [cinema, boardGames], findPlaces: async () => [closed] }),
    );
    expect(plan.items[0]!.activity.id).toBe('board-games');
  });

  it('ignores places outside the reachable radius', async () => {
    const plan = await buildPlan(
      request({ format: 'single', transport: 'walk' }),
      context({
        activities: [cinema, boardGames],
        findPlaces: async () => [place('far-cinema', 10)],
      }),
    );
    expect(plan.items[0]!.activity.id).toBe('board-games');
  });

  it('respects excluded activities when re-rolling', async () => {
    const plan = await buildPlan(
      request({ format: 'single', food: 'none', excludeActivityIds: ['minigolf', 'cinema'] }),
      context(),
    );
    expect(plan.items[0]!.activity.id).toBe('board-games');
  });

  it('keeps pinned items when re-rolling a single slot', async () => {
    const keptPlace = place('kept-minigolf');
    const plan = await buildPlan(
      request({ keep: { 0: { activity: minigolf, place: keptPlace } } }),
      context(),
    );
    expect(plan.items[0]).toMatchObject({
      activity: { id: 'minigolf' },
      place: { id: 'kept-minigolf' },
    });
  });

  // Mandatory cost-protection test (docs/arc42/08): never-matching places must not cause unbounded lookups.
  it('stops after maxPlaceLookups when places never match and falls back to a home activity', async () => {
    const findPlaces = vi.fn(async () => []);
    const many = Array.from({ length: 30 }, (_, i) =>
      activity({ id: `venue-${i}`, placeType: 'venue', placeQuery: 'Venue' }),
    );
    const plan = await buildPlan(
      request({ format: 'day', start: fromLocal('2026-10-10', '10:00') }),
      context({ activities: [...many, boardGames], findPlaces, maxPlaceLookups: 6 }),
    );
    expect(findPlaces).toHaveBeenCalledTimes(6);
    expect(plan.placeLookups).toBe(6);
    expect(plan.warnings).toContain('place_lookup_limit_reached');
    expect(plan.items.map((i) => i.activity.id)).toContain('board-games');
  });

  it('uses the built-in fallback when nothing else fits', async () => {
    const plan = await buildPlan(
      request({ budgetEur: 0 }),
      context({ activities: [minigolf, dinner] }),
    );
    expect(plan.items[0]!.activity.id).toBe(FALLBACK_ACTIVITY.id);
    expect(plan.warnings).toContain('fallback_used');
  });

  it('treats a failing place search like no results', async () => {
    const plan = await buildPlan(
      request({ format: 'single' }),
      context({
        activities: [cinema, boardGames],
        findPlaces: async () => Promise.reject(new Error('down')),
      }),
    );
    expect(plan.items[0]!.activity.id).toBe('board-games');
  });

  it('flags unknown opening hours', async () => {
    const plan = await buildPlan(
      request({ format: 'single' }),
      context({
        activities: [cinema],
        findPlaces: async () => [place('osm-cinema', 2, { openingHours: null })],
      }),
    );
    expect(plan.items[0]!.openingHoursUnknown).toBe(true);
    expect(plan.warnings).toContain('opening_hours_unknown');
  });
});

describe('budget and long days', () => {
  const escapeRoom = activity({
    id: 'escape-room',
    costMinEur: 60,
    costMaxEur: 70,
    placeType: 'escape_room',
    placeQuery: 'Escape Room',
  });
  const cheapCinema = activity({
    id: 'cheap-cinema',
    costMinEur: 20,
    costMaxEur: 30,
    durationMinutes: 120,
    placeType: 'cinema',
    placeQuery: 'Kino',
  });
  const freeWalk = activity({ id: 'free-walk', tags: ['outdoor'], durationMinutes: 60 });
  const library = activity({
    id: 'library',
    durationMinutes: 60,
    placeType: 'library',
    placeQuery: 'Bibliothek',
  });

  it('keeps money back for a planned meal instead of spending it all on the first item', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const plan = await buildPlan(
        request({ food: 'meal', budgetEur: 80 }),
        context({ activities: [escapeRoom, cheapCinema, dinner], random: seededRandom(seed) }),
      );
      expect(plan.items.map((i) => i.activity.id)).toContain('dinner');
      expect(plan.totalCostEur).toBeLessThanOrEqual(80);
    }
  });

  it('keeps time for a planned meal instead of filling the evening with one long activity', async () => {
    const spa = activity({
      id: 'spa',
      durationMinutes: 240,
      costMinEur: 30,
      costMaxEur: 40,
      placeType: 'thermal_bath',
      placeQuery: 'Therme',
    });
    for (let seed = 1; seed <= 20; seed++) {
      const plan = await buildPlan(
        request({ food: 'meal', start: fromLocal('2026-10-10', '18:00') }),
        context({ activities: [spa, cheapCinema, dinner], random: seededRandom(seed) }),
      );
      expect(plan.items.map((i) => i.activity.id)).toContain('dinner');
    }
  });

  it('fills a long day with free ideas instead of ending early', async () => {
    const req = request({
      food: 'none',
      start: fromLocal('2026-10-10', '10:00'),
      end: fromLocal('2026-10-10', '20:00'),
      budgetEur: 40,
    });
    const plan = await buildPlan(
      req,
      context({ activities: [cheapCinema, freeWalk, library, boardGames] }),
    );
    expect(plan.items.length).toBeGreaterThanOrEqual(3);
    expect(plan.items.map((i) => i.activity.id)).toEqual(
      expect.arrayContaining(['free-walk', 'library']),
    );
    const arrival = plan.items.at(-1)!.end.getTime() + (plan.travelHome?.minutes ?? 0) * 60_000;
    expect(arrival).toBeLessThanOrEqual(req.end.getTime());
  });

  it('does not send you home for a filler while out', async () => {
    const plan = await buildPlan(
      request({
        food: 'none',
        slots: ['main'],
        keep: { 0: { activity: cheapCinema, place: placeAt(HOME, 5, 'cinema') } },
        start: fromLocal('2026-10-10', '10:00'),
        end: fromLocal('2026-10-10', '20:00'),
      }),
      context({ activities: [cheapCinema, boardGames] }),
    );
    expect(plan.items.map((i) => i.activity.id)).toEqual(['cheap-cinema']);
  });

  it('only returns home for the last planned item, not in the middle of an outing', async () => {
    const cookAtHome = activity({
      id: 'cook-at-home',
      category: 'food',
      tags: ['food', 'meal'],
      atHome: true,
    });
    for (let seed = 1; seed <= 20; seed++) {
      const plan = await buildPlan(
        request({
          slots: ['main', 'meal', 'main'],
          keep: { 0: { activity: cheapCinema, place: placeAt(HOME, 5, 'cinema') } },
          start: fromLocal('2026-10-10', '12:00'),
          end: fromLocal('2026-10-10', '23:00'),
        }),
        context({
          activities: [cheapCinema, dinner, cookAtHome, freeWalk, boardGames],
          random: seededRandom(seed),
        }),
      );
      expect(plan.items[1]?.activity.atHome).toBe(false);
    }
  });

  it('never plans more than five items', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      activity({ id: `short-${i}`, durationMinutes: 30 }),
    );
    const plan = await buildPlan(
      request({
        food: 'none',
        start: fromLocal('2026-10-10', '08:00'),
        end: fromLocal('2026-10-10', '23:00'),
      }),
      context({ activities: many }),
    );
    expect(plan.items).toHaveLength(5);
  });

  it('only goes over budget when allowed, by at most 50 % and with a warning', async () => {
    const base = { food: 'meal' as const, budgetEur: 40, format: 'evening' as const };
    const strict = await buildPlan(request(base), context({ activities: [freeWalk, dinner] }));
    expect(strict.items.map((i) => i.activity.id)).not.toContain('dinner');
    expect(strict.overBudgetEur).toBe(0);

    const stretched = await buildPlan(
      request({ ...base, allowOverBudget: true }),
      context({ activities: [freeWalk, dinner] }),
    );
    expect(stretched.items.map((i) => i.activity.id)).toContain('dinner');
    expect(stretched.overBudgetEur).toBeGreaterThan(0);
    expect(stretched.totalCostEur).toBeLessThanOrEqual(60);
    expect(stretched.warnings).toContain('over_budget');
  });

  it('reuses the previous slot layout when re-rolling a single item', async () => {
    const plan = await buildPlan(
      request({
        slots: ['meal', 'main'],
        keep: { 0: { activity: dinner, place: placeAt(HOME, 1, 'kept-dinner') } },
      }),
      context(),
    );
    expect(plan.items[0]).toMatchObject({ slot: 'meal', place: { id: 'kept-dinner' } });
    expect(plan.items[1]!.slot).toBe('main');
  });
});

describe('food', () => {
  const italian = activity({
    id: 'italian',
    category: 'food',
    tags: ['food', 'meal', 'italian'],
    costMinEur: 30,
    costMaxEur: 50,
    placeType: 'restaurant',
    placeQuery: 'Italienisch',
  });
  const bavarian = activity({
    id: 'bavarian',
    category: 'food',
    tags: ['food', 'meal', 'bavarian'],
    costMinEur: 30,
    costMaxEur: 50,
    placeType: 'restaurant',
    placeQuery: 'Wirtshaus',
  });

  it('offers up to two alternative venues that fit as well', async () => {
    const venues = [1, 2, 3, 4].map((km) => placeAt(HOME, km, `restaurant-${km}`));
    const plan = await buildPlan(
      request({ food: 'meal', format: 'single', slots: ['meal'] }),
      context({ activities: [italian], findPlaces: async () => venues }),
    );
    const item = plan.items[0]!;
    expect(item.alternatives).toHaveLength(2);
    expect(item.alternatives.map((p) => p.id)).not.toContain(item.place!.id);
  });

  it('leaves out closed venues as alternatives', async () => {
    const closed = { alwaysOpen: false as const, periods: [] };
    const plan = await buildPlan(
      request({ slots: ['meal'] }),
      context({
        activities: [italian],
        findPlaces: async () => [
          placeAt(HOME, 1, 'open'),
          { ...placeAt(HOME, 2, 'closed'), openingHours: closed },
        ],
      }),
    );
    expect(plan.items[0]!.alternatives).toEqual([]);
  });

  it('restricts meals to the chosen cuisine', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const plan = await buildPlan(
        request({ slots: ['meal'], cuisine: 'bavarian' }),
        context({ activities: [italian, bavarian], random: seededRandom(seed) }),
      );
      expect(plan.items[0]!.activity.id).toBe('bavarian');
    }
  });
});

describe('route planning', () => {
  const north = (km: number) => ({ lat: HOME.lat + km / 111, lng: HOME.lng });

  it('searches the first venue around the destination area', async () => {
    const munich = { lat: 48.14, lng: 11.58 };
    const findPlaces = vi.fn<PlanContext['findPlaces']>(async (a, center) => [
      placeAt(center, 1, a.id),
    ]);
    const plan = await buildPlan(
      request({ format: 'single', food: 'none', area: { name: 'München', location: munich } }),
      context({ activities: [cinema, boardGames], findPlaces }),
    );
    expect(findPlaces.mock.calls[0]![1]).toEqual(munich);
    expect(plan.items[0]!.activity.id).toBe('cinema');
  });

  it('sometimes stops near home on the way to the destination', async () => {
    const munich = { lat: 48.14, lng: 11.58 };
    const centers = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const findPlaces = vi.fn<PlanContext['findPlaces']>(async (a, center) => [
        placeAt(center, 1, a.id),
      ]);
      await buildPlan(
        request({ format: 'single', food: 'none', area: { name: 'München', location: munich } }),
        context({ activities: [cinema], findPlaces, random: seededRandom(seed) }),
      );
      centers.add(JSON.stringify(findPlaces.mock.calls[0]![1]));
    }
    expect(centers).toEqual(new Set([JSON.stringify(munich), JSON.stringify(HOME)]));
  });

  it('does not suggest home activities when a destination is set', async () => {
    const plan = await buildPlan(
      request({ format: 'single', food: 'none', area: { name: 'X', location: north(30) } }),
      context({ activities: [boardGames], findPlaces: async () => [] }),
    );
    expect(plan.items[0]!.activity.id).toBe(FALLBACK_ACTIVITY.id);
  });

  it('keeps the next stop close or on the way home, never further out', async () => {
    const cinemaPlace = placeAt(HOME, 30, 'cinema-30km');
    const awayTooFar = placeAt(HOME, 55, 'dinner-55km');
    const onTheWayHome = placeAt(HOME, 3, 'dinner-3km');
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const plan = await buildPlan(
        request({ food: 'meal' }),
        context({
          activities: [cinema, dinner],
          random: seededRandom(seed),
          findPlaces: async (a) => (a.id === 'cinema' ? [cinemaPlace] : [awayTooFar, onTheWayHome]),
        }),
      );
      const [first, second] = plan.items;
      if (first?.activity.id === 'cinema' && second) {
        expect(second.place?.id).toBe('dinner-3km');
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('drops a following stop that only exists far away from the route', async () => {
    const plan = await buildPlan(
      request({ food: 'meal', keep: { 0: { activity: cinema, place: placeAt(HOME, 30, 'c') } } }),
      context({
        activities: [cinema, dinner],
        findPlaces: async () => [placeAt(HOME, 55, 'dinner-55km')],
      }),
    );
    expect(plan.items.map((i) => i.place?.id)).not.toContain('dinner-55km');
  });
});

describe('rules', () => {
  it.each([
    [120, 'single'],
    [240, 'evening'],
    [360, 'evening'],
    [480, 'day'],
  ])('derives format from %i minutes', (minutes, format) => {
    expect(formatFor(minutes)).toBe(format);
  });

  it('favours preferences and penalises recently done activities', () => {
    const empty = { daysSinceSuggested: {}, daysSinceAccepted: {} };
    expect(score(cinema, ['chill'], empty, {})).toBeGreaterThan(score(cinema, [], empty, {}));
    const recent = { daysSinceSuggested: {}, daysSinceAccepted: { cinema: 2 } };
    expect(score(cinema, [], recent, {})).toBeLessThan(score(cinema, [], empty, {}));
    expect(score(cinema, [], recent, {})).toBeGreaterThan(0);
  });
});

describe('estimateTravel', () => {
  it('adds the travel routine for train trips from home', () => {
    const munich = { lat: 48.14, lng: 11.56 };
    const without = estimateTravel(HOME, munich, 'deutschlandticket', undefined);
    const withRoutine = estimateTravel(HOME, munich, 'deutschlandticket', {
      transport: 'deutschlandticket',
      firstLegMinutes: 15,
      bufferMinutes: 5,
    });
    expect(withRoutine.minutes - without.minutes).toBe(20);
    expect(without.costEur).toBe(0);
  });

  it('walks very short distances instead of taking the train', () => {
    const near = { lat: HOME.lat + 0.005, lng: HOME.lng };
    expect(estimateTravel(HOME, near, 'deutschlandticket', undefined).mode).toBe('walk');
  });

  it('uses local transit within a city and the train for longer trips', () => {
    const city = { lat: HOME.lat + 5 / 111, lng: HOME.lng };
    const munich = { lat: 48.14, lng: 11.56 };
    expect(estimateTravel(HOME, city, 'deutschlandticket', undefined).mode).toBe('local_transit');
    expect(estimateTravel(HOME, munich, 'deutschlandticket', undefined).mode).toBe('train');
  });
});

describe('isOpenDuring', () => {
  // Saturday 2026-10-10
  const sat = (time: string) => fromLocal('2026-10-10', time);
  const satOpen = 6 * 1440 + 10 * 60; // Sat 10:00
  const hours = {
    alwaysOpen: false as const,
    periods: [{ start: satOpen, end: satOpen + 12 * 60 }],
  };

  it('accepts intervals inside a period', () => {
    expect(isOpenDuring(hours, sat('12:00'), sat('14:00'))).toBe(true);
  });

  it('rejects intervals reaching past closing time', () => {
    expect(isOpenDuring(hours, sat('21:00'), sat('23:00'))).toBe(false);
  });

  it('handles periods wrapping from Saturday into Sunday', () => {
    const late = {
      alwaysOpen: false as const,
      periods: [{ start: 6 * 1440 + 20 * 60, end: 7 * 1440 + 2 * 60 }],
    };
    expect(isOpenDuring(late, sat('22:00'), fromLocal('2026-10-11', '01:00'))).toBe(true);
    // Sunday 01:00 seen from the start of the week
    expect(
      isOpenDuring(late, fromLocal('2026-10-11', '00:30'), fromLocal('2026-10-11', '01:30')),
    ).toBe(true);
  });
});

describe('summarizeWeather', () => {
  const start = fromLocal('2026-10-10', '17:00');
  const end = fromLocal('2026-10-10', '20:00');
  const hour = (h: number, mm: number, prob: number) => ({
    time: new Date(start.getTime() + h * 3_600_000),
    temperatureC: 10 + h,
    precipitationProbability: prob,
    precipitationMm: mm,
  });

  it('detects rain inside the window', () => {
    const s = summarizeWeather([hour(0, 0, 10), hour(1, 1.2, 80)], start, end, start);
    expect(s).toMatchObject({ dry: false, reliability: 'good', minTempC: 10, maxTempC: 11 });
  });

  it('marks forecasts more than a week ahead as unreliable and missing data as unavailable', () => {
    const now = new Date(start.getTime() - 9 * 86_400_000);
    expect(summarizeWeather([hour(0, 0, 0)], start, end, now).reliability).toBe('low');
    expect(summarizeWeather([], start, end, now)).toMatchObject({ reliability: 'none', dry: null });
  });
});
