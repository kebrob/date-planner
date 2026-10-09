import type { Place, PlaceSearch, PlacesProvider } from '@/ports/places';

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
  private readonly cache = new Map<string, { at: number; places: Place[] }>();

  constructor(
    private readonly inner: PlacesProvider,
    private readonly now: () => number = Date.now,
  ) {}

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
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < TTL_MS) return hit.places;

    const places = await this.inner.search(request);
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: this.now(), places });
    return places;
  }
}
