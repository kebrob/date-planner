import type { Place, PlaceSearch, PlacesProvider } from '@/ports/places';
import { TtlCache } from '../http';

/** Uses the fallback when the primary fails, e.g. because the cost guard denied the call. */
export class FallbackPlacesProvider implements PlacesProvider {
  constructor(
    private readonly primary: PlacesProvider,
    private readonly fallback: PlacesProvider,
  ) {}

  async search(request: PlaceSearch): Promise<Place[]> {
    try {
      return await this.primary.search(request);
    } catch {
      return this.fallback.search(request);
    }
  }
}

/**
 * Skips an unreliable provider for a while after it failed once, so a slow or rate-limited
 * service delays at most one search instead of every search of a plan.
 */
export class CircuitBreakerPlacesProvider implements PlacesProvider {
  private openUntil = 0;

  constructor(
    private readonly inner: PlacesProvider,
    private readonly cooldownMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async search(request: PlaceSearch): Promise<Place[]> {
    if (this.now() < this.openUntil) throw new Error('Provider temporarily skipped');
    try {
      return await this.inner.search(request);
    } catch (error) {
      this.openUntil = this.now() + this.cooldownMs;
      throw error;
    }
  }
}

/** Sends searches for free ideas to a free provider to save paid quota. */
export class RoutingPlacesProvider implements PlacesProvider {
  constructor(
    private readonly paid: PlacesProvider,
    private readonly free: PlacesProvider,
  ) {}

  search(request: PlaceSearch): Promise<Place[]> {
    return (request.free ? this.free : this.paid).search(request);
  }
}

const TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 200;

/**
 * Short-lived in-memory cache so re-rolling a plan does not repeat identical paid lookups.
 * Kept short on purpose: provider terms restrict long-term storage of place data.
 */
export class CachedPlacesProvider implements PlacesProvider {
  private readonly cache: TtlCache<Place[]>;

  constructor(
    private readonly inner: PlacesProvider,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(MAX_ENTRIES, now);
  }

  async search(request: PlaceSearch): Promise<Place[]> {
    const key = JSON.stringify([
      request.free ?? false,
      request.placeType,
      request.query,
      request.center.lat.toFixed(2),
      request.center.lng.toFixed(2),
      request.radiusKm,
      request.maxResults,
    ]);
    const hit = this.cache.get(key, TTL_MS);
    if (hit) return hit;
    const places = await this.inner.search(request);
    this.cache.set(key, places);
    return places;
  }
}
