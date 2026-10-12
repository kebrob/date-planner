/**
 * JSON request with a timeout. Errors name only the provider and status, never the body, which
 * may echo request data.
 */
export async function fetchJson<T>(
  fetchFn: typeof fetch,
  url: string,
  label: string,
  { timeoutMs, ...init }: RequestInit & { timeoutMs: number },
): Promise<T> {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${label} responded ${res.status}`);
  return (await res.json()) as T;
}

/** Small in-memory cache; entries expire after `ttlMs`, the oldest goes first when full. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, ttlMs: number): V | undefined {
    const hit = this.entries.get(key);
    return hit && this.now() - hit.at < ttlMs ? hit.value : undefined;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: this.now(), value });
  }
}
