import { describe, expect, it, vi } from 'vitest';
import { CostGuard } from '@/guard/guard';
import { MemoryUsageStore } from '@/guard/memory-store';
import type { GuardLimits } from '@/guard/types';
import type { PlaceSearch, PlacesProvider } from '@/ports/places';
import { OpenMeteoGeocoder } from './geocoding/open-meteo';
import {
  CachedPlacesProvider,
  CircuitBreakerPlacesProvider,
  FallbackPlacesProvider,
  RoutingPlacesProvider,
} from './places/composite';
import { GooglePlacesProvider, parseOpeningHours, parsePriceRange } from './places/google';
import { buildQuery, OsmPlacesProvider } from './places/osm';
import { OpenMeteoProvider } from './weather/open-meteo';

const limits: GuardLimits = {
  providers: {
    anthropic: { dailyCostUsd: 2, monthlyCostUsd: 15, dailyRequests: 200 },
    google_places: { dailyRequests: 3 },
  },
  callsPerMinute: 100,
  circuitBreaker: { failureThreshold: 5, cooldownMs: 600_000 },
};

const search: PlaceSearch = {
  placeType: 'miniature_golf',
  query: 'Minigolf',
  center: { lat: 47.86, lng: 12.13 },
  radiusKm: 25,
  maxResults: 10,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const googleResponse = {
  places: [
    {
      id: 'g1',
      displayName: { text: 'Minigolf am Inn' },
      location: { latitude: 47.85, longitude: 12.12 },
      formattedAddress: 'Innstraße 1, Rosenheim',
      googleMapsUri: 'https://maps.google.com/?cid=1',
      rating: 4.4,
      regularOpeningHours: {
        periods: [
          { open: { day: 6, hour: 10, minute: 0 }, close: { day: 6, hour: 22, minute: 0 } },
        ],
      },
    },
    { id: 'g2' },
  ],
};

const osmResponse = {
  elements: [
    {
      type: 'node',
      id: 1,
      lat: 47.85,
      lon: 12.12,
      tags: { name: 'Minigolf Kolbermoor', opening_hours: 'Mo-Su 10:00-20:00' },
    },
    {
      type: 'way',
      id: 2,
      center: { lat: 47.9, lon: 12.1 },
      tags: { name: 'Adventure Golf', opening_hours: '24/7' },
    },
    { type: 'node', id: 3, lat: 47.8, lon: 12.0, tags: {} },
  ],
};

describe('GooglePlacesProvider', () => {
  it('maps the response and sends key and field mask headers', async () => {
    const fetchFn = vi.fn(async () => json(googleResponse));
    const guard = new CostGuard({ store: new MemoryUsageStore(), limits });
    const places = await new GooglePlacesProvider('test-key', guard, fetchFn).search(search);

    expect(places).toEqual([
      {
        provider: 'google',
        id: 'g1',
        name: 'Minigolf am Inn',
        location: { lat: 47.85, lng: 12.12 },
        address: 'Innstraße 1, Rosenheim',
        rating: 4.4,
        openingHours: {
          alwaysOpen: false,
          periods: [{ start: 6 * 1440 + 600, end: 6 * 1440 + 1320 }],
        },
        mapsUrl: 'https://maps.google.com/?cid=1',
      },
    ]);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(headers['X-Goog-FieldMask']).toContain('places.regularOpeningHours');
    const box = JSON.parse(init.body as string).locationRestriction.rectangle;
    expect(box.low.latitude).toBeCloseTo(47.86 - 25 / 111, 5);
    expect(box.high.latitude).toBeCloseTo(47.86 + 25 / 111, 5);
    expect(box.high.longitude - box.low.longitude).toBeGreaterThan(
      box.high.latitude - box.low.latitude,
    );
  });

  it('adds a strict Google type where one exists and leaves others to the text query', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({ places: [] }));
    const guard = new CostGuard({ store: new MemoryUsageStore(), limits });
    const provider = new GooglePlacesProvider('k', guard, fetchFn);
    await provider.search({ ...search, placeType: 'park', query: 'Park' });
    await provider.search({ ...search, placeType: 'escape_room', query: 'Escape Room' });
    const body = (i: number) =>
      JSON.parse((fetchFn.mock.calls[i]![1] as RequestInit).body as string);
    expect(body(0)).toMatchObject({ includedType: 'park', strictTypeFiltering: true });
    expect(body(1).includedType).toBeUndefined();
  });

  // Mandatory cost-protection test (docs/arc42/08)
  it('stops calling Google once the daily limit is reached and the fallback takes over', async () => {
    const googleFetch = vi.fn(async () => json(googleResponse));
    const guard = new CostGuard({ store: new MemoryUsageStore(), limits });
    const fallback: PlacesProvider = { search: vi.fn(async () => []) };
    const provider = new FallbackPlacesProvider(
      new GooglePlacesProvider('k', guard, googleFetch),
      fallback,
    );

    for (let i = 0; i < 5; i++) await provider.search({ ...search, query: `q${i}` });

    expect(googleFetch).toHaveBeenCalledTimes(3);
    expect(fallback.search).toHaveBeenCalledTimes(2);
  });

  it('throws on HTTP errors so the fallback can take over', async () => {
    const guard = new CostGuard({ store: new MemoryUsageStore(), limits });
    const provider = new GooglePlacesProvider('k', guard, async () => json({ error: {} }, 403));
    await expect(provider.search(search)).rejects.toThrow('403');
  });
});

describe('parseOpeningHours', () => {
  it('detects always-open places', () => {
    expect(parseOpeningHours({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] })).toEqual({
      alwaysOpen: true,
    });
  });

  it('wraps periods closing after Saturday midnight', () => {
    const hours = parseOpeningHours({
      periods: [{ open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }],
    });
    expect(hours).toEqual({
      alwaysOpen: false,
      periods: [{ start: 6 * 1440 + 1200, end: 7 * 1440 + 120 }],
    });
  });

  it('returns null without data', () => {
    expect(parseOpeningHours(undefined)).toBeNull();
  });
});

describe('parsePriceRange', () => {
  const eur = (units: string) => ({ currencyCode: 'EUR', units });

  it('reads a euro range per person', () => {
    expect(parsePriceRange({ startPrice: eur('20'), endPrice: eur('30') })).toEqual({
      min: 20,
      max: 30,
    });
  });

  it('keeps an open-ended range without upper bound', () => {
    expect(parsePriceRange({ startPrice: eur('50') })).toEqual({ min: 50, max: null });
  });

  it('ignores missing or non-euro prices', () => {
    expect(parsePriceRange(undefined)).toBeUndefined();
    expect(parsePriceRange({ startPrice: { currencyCode: 'USD', units: '20' } })).toBeUndefined();
  });
});

describe('OsmPlacesProvider', () => {
  it('maps named elements and only trusts 24/7 opening hours', async () => {
    const places = await new OsmPlacesProvider(async () => json(osmResponse)).search(search);
    expect(places).toEqual([
      {
        provider: 'osm',
        id: 'node/1',
        name: 'Minigolf Kolbermoor',
        location: { lat: 47.85, lng: 12.12 },
        address: undefined,
        openingHours: null,
      },
      {
        provider: 'osm',
        id: 'way/2',
        name: 'Adventure Golf',
        location: { lat: 47.9, lng: 12.1 },
        address: undefined,
        openingHours: { alwaysOpen: true },
      },
    ]);
  });

  it('does not call Overpass for unknown place types', async () => {
    const fetchFn = vi.fn(async () => json(osmResponse));
    expect(
      await new OsmPlacesProvider(fetchFn).search({ ...search, placeType: 'unknown' }),
    ).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('builds an around query with the radius in metres, capped at 15 km', () => {
    expect(buildQuery(search)).toContain(
      'nwr["leisure"="miniature_golf"]["name"](around:15000,47.86,12.13);',
    );
  });
});

describe('CircuitBreakerPlacesProvider', () => {
  it('skips a failing provider for the cooldown, then tries again', async () => {
    let now = 0;
    const inner: PlacesProvider = {
      search: vi
        .fn<PlacesProvider['search']>()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue([]),
    };
    const breaker = new CircuitBreakerPlacesProvider(inner, 600_000, () => now);
    await expect(breaker.search(search)).rejects.toThrow('timeout');
    await expect(breaker.search(search)).rejects.toThrow('skipped');
    expect(inner.search).toHaveBeenCalledTimes(1);
    now = 600_000;
    await expect(breaker.search(search)).resolves.toEqual([]);
    expect(inner.search).toHaveBeenCalledTimes(2);
  });
});

describe('RoutingPlacesProvider', () => {
  it('sends free ideas to the free provider and everything else to the paid one', async () => {
    const paid: PlacesProvider = { search: vi.fn(async () => []) };
    const free: PlacesProvider = { search: vi.fn(async () => []) };
    const routing = new RoutingPlacesProvider(paid, free);
    await routing.search({ ...search, placeType: 'park', free: true });
    await routing.search(search);
    expect(free.search).toHaveBeenCalledTimes(1);
    expect(paid.search).toHaveBeenCalledTimes(1);
  });
});

describe('CachedPlacesProvider', () => {
  it('serves repeated searches from cache and expires after an hour', async () => {
    let now = 0;
    const inner: PlacesProvider = { search: vi.fn(async () => []) };
    const cached = new CachedPlacesProvider(inner, () => now);
    await cached.search(search);
    await cached.search(search);
    expect(inner.search).toHaveBeenCalledTimes(1);
    now = 60 * 60_000;
    await cached.search(search);
    expect(inner.search).toHaveBeenCalledTimes(2);
  });
});

describe('OpenMeteoProvider', () => {
  const now = new Date('2026-10-09T12:00:00Z');

  it('parses hourly UTC data', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json({
        hourly: {
          time: ['2026-10-10T15:00', '2026-10-10T16:00'],
          temperature_2m: [14.2, null],
          precipitation_probability: [20, 30],
          precipitation: [0, 0.1],
        },
      }),
    );
    const hours = await new OpenMeteoProvider(fetchFn, () => now).hourly(
      { lat: 47.86, lng: 12.13 },
      new Date('2026-10-10T15:00:00Z'),
      new Date('2026-10-10T21:00:00Z'),
    );
    expect(hours).toEqual([
      {
        time: new Date('2026-10-10T15:00:00Z'),
        temperatureC: 14.2,
        precipitationProbability: 20,
        precipitationMm: 0,
      },
    ]);
    expect(String(fetchFn.mock.calls[0]![0])).toContain('start_date=2026-10-10');
  });

  it('skips the request beyond the forecast horizon', async () => {
    const fetchFn = vi.fn();
    const hours = await new OpenMeteoProvider(fetchFn, () => now).hourly(
      { lat: 47.86, lng: 12.13 },
      new Date('2026-11-01T15:00:00Z'),
      new Date('2026-11-01T21:00:00Z'),
    );
    expect(hours).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('OpenMeteoGeocoder', () => {
  it('returns the best match restricted to Germany', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json({
        results: [{ name: 'München', latitude: 48.137, longitude: 11.575, admin1: 'Bayern' }],
      }),
    );
    const area = await new OpenMeteoGeocoder(fetchFn).find(' München ');
    expect(area).toEqual({ name: 'München, Bayern', location: { lat: 48.137, lng: 11.575 } });
    const url = String(fetchFn.mock.calls[0]![0]);
    expect(url).toContain('name=M%C3%BCnchen');
    expect(url).toContain('countryCode=DE');
  });

  it('returns null when nothing matches', async () => {
    expect(await new OpenMeteoGeocoder(async () => json({})).find('Nowhere')).toBeNull();
  });
});
