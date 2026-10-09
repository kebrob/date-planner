import { describe, expect, it } from 'vitest';
import { fromActivityForm, toActivityForm, type ActivityForm } from './service';

const row = {
  id: 'a1',
  title: 'Italian dinner',
  description: 'Pasta and wine',
  category: 'food',
  tags: ['food', 'meal', 'italian', 'romantic'],
  costMinEur: 35,
  costMaxEur: 60,
  durationMinutes: 90,
  weather: { dryOnly: true, minTempC: 10 },
  transports: ['car' as const],
  atHome: false,
  placeType: 'restaurant',
  placeQuery: 'Italienisches Restaurant',
  timesOfDay: ['evening'],
  seasons: [],
  preparation: null,
  status: 'active' as const,
  source: 'manual' as const,
  createdAt: new Date(),
};

describe('activity form mapping', () => {
  it('splits food tags into kind, cuisine and mood tags', () => {
    expect(toActivityForm(row)).toMatchObject({
      kind: 'meal',
      cuisine: 'italian',
      tags: ['romantic'],
      dryOnly: true,
      minTempC: 10,
    });
  });

  it('round-trips without losing tags or settings', () => {
    const back = fromActivityForm(toActivityForm(row));
    expect(back).toMatchObject({
      category: 'food',
      tags: ['food', 'meal', 'italian', 'romantic'],
      weather: { dryOnly: true, minTempC: 10 },
      transports: ['car'],
      placeType: 'restaurant',
      status: 'active',
    });
  });

  it('rejects inconsistent input', () => {
    const base = toActivityForm(row);
    expect(() => fromActivityForm({ ...base, costMinEur: 80 })).toThrow(/Min cost/);
    expect(() => fromActivityForm({ ...base, placeQuery: '' } satisfies ActivityForm)).toThrow(
      /search term/,
    );
    expect(() => fromActivityForm({ ...base, placeType: 'spaceship' })).toThrow();
  });
});
