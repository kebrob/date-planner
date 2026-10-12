import { describe, expect, it } from 'vitest';
import { fromLocal } from '@/lib/time';
import { buildPlan } from './build-plan';
import { seededRandom } from './random';
import { NO_LEARNING } from './rules';
import type { Activity, PlanContext, PlanRequest, Slot } from './types';

const HOME = { lat: 47.86, lng: 12.13 };
const act = (id: string, o: Partial<Activity> = {}): Activity => ({
  id,
  title: id,
  description: '',
  category: 'activity',
  tags: [],
  costMinEur: 0,
  costMaxEur: 10,
  durationMinutes: 60,
  weather: {},
  transports: [],
  atHome: false,
  placeType: null,
  placeQuery: null,
  timesOfDay: [],
  seasons: [],
  preparation: null,
  ...o,
});
const ideas: Activity[] = [
  ...Array.from({ length: 4 }, (_, i) =>
    act(`home${i}`, { atHome: true, tags: ['home'], durationMinutes: 45 + i * 15 }),
  ),
  ...Array.from({ length: 4 }, (_, i) => act(`out${i}`, { durationMinutes: 60 + i * 15 })),
  ...Array.from({ length: 3 }, (_, i) =>
    act(`venue${i}`, { placeType: 'cinema', placeQuery: 'x', durationMinutes: 90 }),
  ),
  ...Array.from({ length: 3 }, (_, i) =>
    act(`meal${i}`, {
      category: 'food',
      tags: ['food', 'meal'],
      placeType: 'restaurant',
      placeQuery: 'r',
      durationMinutes: 75,
    }),
  ),
  ...Array.from({ length: 2 }, (_, i) =>
    act(`snack${i}`, {
      category: 'food',
      tags: ['food', 'snack'],
      placeType: 'cafe',
      placeQuery: 'c',
      durationMinutes: 30,
    }),
  ),
];
const place = (id: string, km: number) => ({
  provider: 'osm' as const,
  id,
  name: id,
  location: { lat: HOME.lat + km / 111, lng: HOME.lng },
  openingHours: { alwaysOpen: true as const },
});

// Random combinations of kept, pinned, fixed-time and required stops; found a real duplicate bug.
const SEEDS = 500;

describe('fuzz: no idea twice in a plan', () => {
  it('holds across random keep/pin/anchor/required combinations', async () => {
    let checked = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = seededRandom(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
      const n = 1 + Math.floor(r() * 5);
      const slots: Slot[] = Array.from({ length: n }, () =>
        pick(['main', 'main', 'meal', 'snack'] as Slot[]),
      );
      const req: PlanRequest = {
        start: fromLocal('2026-10-17', '10:00'),
        end: fromLocal('2026-10-17', pick(['16:00', '20:00', '23:30'])),
        budgetEur: pick([30, 80, 200]),
        transport: pick(['car', 'walk', 'deutschlandticket'] as const),
        preferences: [],
        excludeActivityIds: [],
        allowOverBudget: true,
        slots,
      };
      const used = new Set<string>();
      const fresh = (pred: (a: Activity) => boolean) => {
        const c = ideas.filter((a) => pred(a) && !used.has(a.id));
        if (!c.length) return null;
        const a = pick(c);
        used.add(a.id);
        return a;
      };
      const keep: NonNullable<PlanRequest['keep']> = {};
      const pins: NonNullable<PlanRequest['pins']> = {};
      slots.forEach((s, i) => {
        const roll = r();
        const kind = (a: Activity) =>
          s === 'main' ? !a.tags.includes('food') : a.tags.includes(s);
        if (roll < 0.4) {
          const a = fresh(kind);
          if (a)
            keep[i] = { activity: a, place: a.placeType ? place(`${a.id}-p`, 1 + r() * 3) : null };
        } else if (roll < 0.55) {
          const a = fresh(kind);
          if (a)
            pins[i] = { activity: a, place: a.placeType ? place(`${a.id}-p`, 1 + r() * 3) : null };
        }
      });
      if (Object.keys(keep).length) req.keep = keep;
      if (Object.keys(pins).length) req.pins = pins;
      if (r() < 0.3) {
        const a = fresh(() => true);
        if (a)
          req.anchors = [
            {
              activity: a,
              place: a.placeType ? place(`${a.id}-p`, 2) : null,
              start: fromLocal('2026-10-17', pick(['12:00', '14:30', '15:00'])),
            },
          ];
      }
      if (r() < 0.3) {
        const a = fresh(() => true);
        if (a) req.required = [a];
      }
      if (r() < 0.3) req.food = pick(['meal', 'snack', 'auto'] as const);
      const ctx: PlanContext = {
        home: HOME,
        maxRadiusKm: 80,
        routines: [],
        activities: ideas,
        history: { daysSinceSuggested: {}, daysSinceAccepted: {} },
        weather: { reliability: 'good', dry: true, minTempC: 12, maxTempC: 18 },
        forecast: [],
        learning: NO_LEARNING,
        maxPlaceLookups: 6,
        maxFreePlaceLookups: 6,
        findPlaces: async (a, c) =>
          [1, 2, 3].map((k) => ({
            ...place(`${a.id}-${k}`, k),
            location: { lat: c.lat + k / 111, lng: c.lng },
          })),
        random: seededRandom(seed * 7),
      };
      const plan = await buildPlan(req, ctx);
      const ids = plan.items.map((i) => i.activity.id);
      if (new Set(ids).size !== ids.length)
        throw new Error(
          `seed ${seed}: ${ids.join(',')} keep=${JSON.stringify(Object.fromEntries(Object.entries(keep).map(([k, v]) => [k, v.activity.id])))} pins=${JSON.stringify(Object.fromEntries(Object.entries(pins).map(([k, v]) => [k, v.activity.id])))} anchor=${req.anchors?.[0]?.activity.id} required=${req.required?.[0]?.id}`,
        );
      checked++;
    }
    expect(checked).toBe(SEEDS);
  });
});
