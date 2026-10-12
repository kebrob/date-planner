import { describe, expect, it } from 'vitest';
import { fetchJson, TtlCache } from './http';

describe('TtlCache', () => {
  it('expires entries and drops the oldest when full', () => {
    let now = 0;
    const cache = new TtlCache<number>(2, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a', 100)).toBe(1);
    now = 150;
    expect(cache.get('a', 100)).toBeUndefined();
    cache.set('c', 3);
    expect(cache.get('a', 1_000)).toBeUndefined();
    expect(cache.get('c', 1_000)).toBe(3);
  });
});

describe('fetchJson', () => {
  it('names the provider and status but not the response body', async () => {
    const fetchFn = (async () =>
      new Response('secret echo of the request', { status: 503 })) as typeof fetch;
    await expect(fetchJson(fetchFn, 'https://x', 'Test API', { timeoutMs: 1_000 })).rejects.toThrow(
      /^Test API responded 503$/,
    );
  });
});
