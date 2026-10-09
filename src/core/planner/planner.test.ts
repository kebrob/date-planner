import { describe, expect, it, vi } from 'vitest';
import { fromLocal } from '@/lib/time';
import type { LatLng, Place } from '@/ports/places';
import { buildPlan, FALLBACK_ACTIVITY, firstStopRadiusKm } from './build-plan';
import { estimateTravel } from './geo';
import { isOpenDuring } from './opening-hours';
import { seededRandom } from './random';
import { formatFor, itemCost, score } from './rules';
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

  it('plans a single long item rather than nothing when the reserve for later slots does not fit', async () => {
    const spa = activity({
      id: 'spa',
      durationMinutes: 240,
      placeType: 'thermal_bath',
      placeQuery: 'Therme',
    });
    const plan = await buildPlan(
      request({
        slots: ['main', 'meal'],
        start: fromLocal('2026-10-10', '18:00'),
        end: fromLocal('2026-10-10', '22:30'),
      }),
      context({ activities: [spa, dinner] }),
    );
    expect(plan.items.map((i) => i.activity.id)).toContain('spa');
    expect(plan.warnings).not.toContain('fallback_used');
  });

  it('reuses places found earlier in the same plan instead of spending new lookups', async () => {
    const findPlaces = vi.fn(async (_a: Activity, center: LatLng) => [placeAt(center, 1, 'p')]);
    const longDinner = activity({ ...dinner, id: 'long-dinner', durationMinutes: 150 });
    await buildPlan(
      request({
        slots: ['meal', 'main'],
        start: fromLocal('2026-10-10', '18:00'),
        end: fromLocal('2026-10-10', '21:00'),
      }),
      context({ activities: [longDinner, cinema], findPlaces, maxPlaceLookups: 2 }),
    );
    // The meal is retried without reserves; that retry must not search again.
    expect(findPlaces.mock.calls.filter(([a]) => a.id === 'long-dinner')).toHaveLength(1);
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

describe('distance and required stops', () => {
  it('derives the first-stop radius from the time window unless a distance is chosen', () => {
    const ctx = context({ maxRadiusKm: 200 });
    const short = request({
      start: fromLocal('2026-10-10', '18:00'),
      end: fromLocal('2026-10-10', '20:00'),
    });
    const long = request({
      start: fromLocal('2026-10-10', '08:00'),
      end: fromLocal('2026-10-10', '22:00'),
    });
    expect(firstStopRadiusKm(short, ctx)).toBe(20); // 30 min by car
    expect(firstStopRadiusKm(long, ctx)).toBe(80); // capped at 120 min
    expect(firstStopRadiusKm({ ...short, maxDistanceKm: 5 }, ctx)).toBe(5);
    expect(firstStopRadiusKm({ ...short, transport: 'walk', maxDistanceKm: 50 }, ctx)).toBe(4);
  });

  it('respects a chosen maximum distance', async () => {
    const plan = await buildPlan(
      request({ format: 'single', food: 'none', maxDistanceKm: 5 }),
      context({
        activities: [cinema, boardGames],
        findPlaces: async () => [place('cinema-8km', 8)],
      }),
    );
    expect(plan.items[0]!.activity.id).toBe('board-games');
  });

  it('always plans requested stops first and adds slots for them', async () => {
    const shopping = activity({
      id: 'adhoc-shopping',
      placeType: 'mall',
      placeQuery: 'Shopping',
      durationMinutes: 120,
    });
    for (let seed = 1; seed <= 10; seed++) {
      const plan = await buildPlan(
        request({ format: 'single', food: 'meal', required: [shopping] }),
        context({ activities: [cinema, dinner, shopping], random: seededRandom(seed) }),
      );
      expect(plan.items.map((i) => i.activity.id)).toContain('adhoc-shopping');
    }
  });

  it('warns when a requested stop cannot be planned', async () => {
    const shopping = activity({ id: 'adhoc-shopping', placeType: 'mall', placeQuery: 'Shopping' });
    const plan = await buildPlan(
      request({ format: 'single', food: 'none', required: [shopping] }),
      context({ activities: [boardGames, shopping], findPlaces: async () => [] }),
    );
    expect(plan.warnings).toContain('required_skipped');
  });
});

describe('sun-dependent ideas', () => {
  const sunset = activity({ id: 'sunset', tags: ['sunset'], durationMinutes: 90 });
  const stars = activity({ id: 'stars', tags: ['after_dark'], durationMinutes: 60 });

  it('schedules sunset ideas so that they include the actual sunset (~18:40 in October)', async () => {
    const plan = await buildPlan(
      request({
        slots: ['main'],
        start: fromLocal('2026-10-09', '17:30'),
        end: fromLocal('2026-10-09', '22:00'),
      }),
      context({ activities: [sunset] }),
    );
    const item = plan.items[0]!;
    expect(item.activity.id).toBe('sunset');
    expect(item.start <= fromLocal('2026-10-09', '18:30')).toBe(true);
    expect(item.end >= fromLocal('2026-10-09', '18:40')).toBe(true);
  });

  it('does not plan a sunset idea after the sun has set', async () => {
    const plan = await buildPlan(
      request({
        slots: ['main'],
        start: fromLocal('2026-10-09', '19:30'),
        end: fromLocal('2026-10-09', '23:00'),
      }),
      context({ activities: [sunset, boardGames] }),
    );
    expect(plan.items[0]!.activity.id).toBe('board-games');
  });

  it('starts after-dark ideas well after sunset', async () => {
    const plan = await buildPlan(
      request({
        slots: ['main'],
        start: fromLocal('2026-10-09', '18:30'),
        end: fromLocal('2026-10-09', '23:00'),
      }),
      context({ activities: [stars] }),
    );
    expect(plan.items[0]!.start >= fromLocal('2026-10-09', '19:20')).toBe(true);
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

  it('always starts at a chosen destination, never near home first', async () => {
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
    expect(centers).toEqual(new Set([JSON.stringify(munich)]));
  });

  it('spends no place lookup on ideas that cannot fit the time window there', async () => {
    const findPlaces = vi.fn<PlanContext['findPlaces']>(async (a, center) => [
      placeAt(center, 1, a.id),
    ]);
    // Hours of driving each way leave no room for the cinema in a 4 h window.
    await buildPlan(
      request({
        end: fromLocal('2026-10-10', '21:00'),
        format: 'single',
        food: 'none',
        area: { name: 'Far away', location: north(200) },
      }),
      context({ activities: [cinema], findPlaces }),
    );
    expect(findPlaces).not.toHaveBeenCalled();
  });

  it('starts in the destination when already there, without a trip from home', async () => {
    const munich = { lat: 48.14, lng: 11.58 };
    const plan = await buildPlan(
      request({
        format: 'single',
        food: 'none',
        area: { name: 'München', location: munich },
        startInArea: true,
      }),
      context({
        activities: [cinema],
        findPlaces: async (a, center) => [placeAt(center, 0.3, a.id)],
      }),
    );
    expect(plan.startsInArea).toBe(true);
    expect(plan.items[0]!.travelBefore!.distanceKm).toBeLessThan(2);
    expect(plan.travelHome!.distanceKm).toBeGreaterThan(30);
  });

  it('plans no way home when staying in the destination', async () => {
    const munich = { lat: 48.14, lng: 11.58 };
    const plan = await buildPlan(
      request({
        format: 'single',
        food: 'none',
        area: { name: 'München', location: munich },
        startInArea: true,
        endInArea: true,
      }),
      context({
        activities: [cinema, boardGames],
        findPlaces: async (a, center) => [placeAt(center, 0.3, a.id)],
      }),
    );
    expect(plan.travelHome).toBeNull();
    expect(plan.items.every((i) => !i.activity.atHome)).toBe(true);
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

describe('itemCost', () => {
  const dinner = activity({ id: 'dinner', category: 'food', costMinEur: 30, costMaxEur: 55 });

  it('uses the venue price per person for two people', () => {
    expect(itemCost(dinner, place('inn', 1, { pricePerPerson: { min: 20, max: 30 } }))).toBe(50);
    expect(itemCost(dinner, place('inn', 1, { pricePerPerson: { min: 40, max: null } }))).toBe(80);
  });

  it('falls back to the activity estimate without a venue price', () => {
    expect(itemCost(dinner, place('inn'))).toBe(43);
    expect(itemCost(dinner, null)).toBe(43);
  });

  it('ignores venue prices for non-food activities', () => {
    const bowling = activity({ id: 'bowling', costMinEur: 20, costMaxEur: 30 });
    expect(itemCost(bowling, place('alley', 1, { pricePerPerson: { min: 5, max: 10 } }))).toBe(25);
  });
});
