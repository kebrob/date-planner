/** Deterministic PRNG (mulberry32) so tests can seed plan generation. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Returns items in weighted-random order (weighted sampling without replacement). */
export function weightedShuffle<T>(
  items: T[],
  weight: (item: T) => number,
  random: () => number,
): T[] {
  // Efraimidis–Spirakis: sort by random^(1/weight), descending.
  return items
    .map((item) => ({ item, key: Math.pow(random(), 1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}
