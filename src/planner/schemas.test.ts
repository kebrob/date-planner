import { describe, expect, it } from 'vitest';
import { buildPlan } from '@/core/planner/build-plan';
import { seededRandom } from '@/core/planner/random';
import { NO_LEARNING } from '@/core/planner/rules';
import type { Activity } from '@/core/planner/types';
import { fromLocal } from '@/lib/time';
import type { Place } from '@/ports/places';
import { placeSchema, planViewSchema } from './schemas';
import { toPlanView } from './view';

const HOME = { lat: 47.86, lng: 12.13 };
const venue: Place = {
  provider: 'google',
  id: 'g1',
  name: 'Kino',
  location: { lat: 47.87, lng: 12.13 },
  openingHours: { alwaysOpen: true },
  mapsUrl: 'https://maps.google.com/?cid=1',
  website: 'http://kino.example',
  pricePerPerson: { min: 10, max: null },
};
const cinema: Activity = {
  id: 'cinema',
  title: 'Cinema',
  description: '',
  category: 'activity',
  tags: ['indoor'],
  costMinEur: 10,
  costMaxEur: 20,
  durationMinutes: 150,
  weather: {},
  transports: [],
  atHome: false,
  placeType: 'cinema',
  placeQuery: 'Kino',
  timesOfDay: [],
  seasons: [],
  preparation: null,
};

async function view() {
  const plan = await buildPlan(
    {
      start: fromLocal('2026-10-10', '18:00'),
      end: fromLocal('2026-10-10', '23:00'),
      budgetEur: 100,
      transport: 'car',
      preferences: [],
      food: 'none',
      excludeActivityIds: [],
    },
    {
      home: HOME,
      maxRadiusKm: 50,
      routines: [],
      activities: [cinema],
      history: { daysSinceSuggested: {}, daysSinceAccepted: {} },
      weather: { reliability: 'good', dry: true, minTempC: 10, maxTempC: 15 },
      forecast: [],
      learning: NO_LEARNING,
      maxPlaceLookups: 5,
      maxFreePlaceLookups: 5,
      findPlaces: async () => [venue],
      random: seededRandom(1),
    },
  );
  return toPlanView(plan, HOME, null);
}

describe('planViewSchema', () => {
  it('accepts a plan as the planner makes it, keeping all place details', async () => {
    const v = await view();
    expect(planViewSchema.parse(v)).toEqual(v);
  });

  it('rejects script links and empty plans', async () => {
    const v = await view();
    const item = v.items[0]!;
    const scripted = {
      ...v,
      items: [{ ...item, place: { ...venue, mapsUrl: 'javascript:alert(1)' } }],
    };
    expect(planViewSchema.safeParse(scripted).success).toBe(false);
    expect(planViewSchema.safeParse({ ...v, items: [] }).success).toBe(false);
  });
});

describe('placeSchema', () => {
  it('keeps website and price per person of chosen places', () => {
    expect(placeSchema.parse(venue)).toEqual(venue);
  });

  it('drops a website that is not a web link instead of rejecting the place', () => {
    expect(placeSchema.parse({ ...venue, website: 'javascript:alert(1)' }).website).toBeUndefined();
  });
});
