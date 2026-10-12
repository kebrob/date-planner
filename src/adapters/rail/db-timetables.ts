import { addMinutes, fromLocal, toLocalDate, toLocalTime } from '@/lib/time';
import { TtlCache } from '../http';
import type { RailTimetable, StationEvent, StationStop } from '@/ports/rail';

const BASE = 'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1';
const TIMEOUT_MS = 5_000;
// Free plan allows 60 calls per minute; stay below it.
const MAX_CALLS_PER_MINUTE = 50;
// Planned timetables only change with timetable updates; realtime changes go stale quickly.
const PLAN_TTL_MS = 6 * 60 * 60_000;
const CHANGES_TTL_MS = 30_000;
const CACHE_SIZE = 200;

export class RailLimitError extends Error {}

type Attrs = Record<string, string>;
type RawStop = { id: string; tl?: Attrs; ar?: Attrs; dp?: Attrs };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

function attributes(source: string): Attrs {
  const result: Attrs = {};
  for (const [, key, value] of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    result[key!] = decode(value!);
  }
  return result;
}

/** Timetable XML is flat (station → stop → tl/ar/dp), so a small parser is enough. */
export function parseTimetable(xml: string): RawStop[] {
  const stops: RawStop[] = [];
  for (const [, head, body] of xml.matchAll(/<s\s([^>]*?)(?:\/>|>([\s\S]*?)<\/s>)/g)) {
    const stop: RawStop = { id: attributes(head!).id ?? '' };
    for (const [, tag, attrs] of (body ?? '').matchAll(/<(tl|ar|dp)\b([^>]*?)\/?>/g)) {
      stop[tag as 'tl' | 'ar' | 'dp'] = attributes(attrs!);
    }
    if (stop.id) stops.push(stop);
  }
  return stops;
}

/** "YYMMddHHmm" in German local time. */
export function parseTime(value: string | undefined): Date | null {
  if (!value || !/^\d{10}$/.test(value)) return null;
  const [yy, mm, dd, hh, mi] = [0, 2, 4, 6, 8].map((i) => value.slice(i, i + 2));
  return fromLocal(`20${yy}-${mm}-${dd}`, `${hh}:${mi}`);
}

/** Date ("YYMMdd") and hour ("HH") of the timetable slot containing `date`. */
function slotOf(date: Date) {
  const [y, m, d] = toLocalDate(date).split('-');
  return { date: `${y!.slice(2)}${m}${d}`, hour: toLocalTime(date).slice(0, 2) };
}

function toEvent(planned?: Attrs, change?: Attrs): StationEvent | null {
  const plannedTime = parseTime(planned?.pt);
  if (!plannedTime) return null;
  const path = change?.cpth ?? planned?.ppth;
  return {
    planned: plannedTime,
    actual: parseTime(change?.ct) ?? plannedTime,
    platform: change?.cp ?? planned?.pp ?? null,
    plannedPlatform: planned?.pp ?? null,
    cancelled: change?.cs === 'c',
    path: path ? path.split('|').filter(Boolean) : [],
  };
}

/** "RB54" → "RB 54"; names that already have a space stay as they are. */
function lineName(name: string): string {
  return name.replace(/^([A-Za-z]+)(\d)/, '$1 $2');
}

function toStop(raw: RawStop, change?: RawStop): StationStop | null {
  const category = raw.tl?.c;
  const number = raw.tl?.n;
  if (!category || !number) return null;
  const name = raw.dp?.l ?? raw.ar?.l ?? raw.dp?.fb ?? raw.ar?.fb ?? `${category} ${number}`;
  return {
    id: raw.id,
    category,
    number,
    line: lineName(name),
    arrival: toEvent(raw.ar, change?.ar),
    departure: toEvent(raw.dp, change?.dp),
  };
}

function applyChange(stop: StationStop, change: RawStop | undefined): StationStop {
  if (!change) return stop;
  const update = (event: StationEvent | null, c?: Attrs): StationEvent | null =>
    event && c
      ? {
          ...event,
          actual: parseTime(c.ct) ?? event.actual,
          platform: c.cp ?? event.platform,
          cancelled: c.cs === 'c' ? true : c.cs === 'p' ? false : event.cancelled,
          path: c.cpth ? c.cpth.split('|').filter(Boolean) : event.path,
        }
      : event;
  return {
    ...stop,
    arrival: update(stop.arrival, change.ar),
    departure: update(stop.departure, change.dp),
  };
}

export class DbTimetablesProvider implements RailTimetable {
  private readonly cache: TtlCache<RawStop[]>;
  // Station numbers practically never change.
  private readonly stationNumbers = new Map<string, string | null>();
  private calls: number[] = [];

  constructor(
    private readonly clientId: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(CACHE_SIZE, now);
  }

  async stops(eva: string, from: Date, hours: number): Promise<StationStop[]> {
    const until = addMinutes(from, hours * 60);
    const slots: { date: string; hour: string }[] = [];
    for (let t = from; t < until; t = addMinutes(t, 60)) slots.push(slotOf(t));
    const [changes, ...plans] = await Promise.all([
      this.get(`/fchg/${eva}`, CHANGES_TTL_MS),
      ...slots.map((s) => this.get(`/plan/${eva}/${s.date}/${s.hour}`, PLAN_TTL_MS)),
    ]);
    const changeById = new Map(changes!.map((c) => [c.id, c]));
    const seen = new Set<string>();
    return plans.flat().flatMap((raw) => {
      if (seen.has(raw.id)) return [];
      seen.add(raw.id);
      const stop = toStop(raw, changeById.get(raw.id));
      return stop ? [stop] : [];
    });
  }

  async stationNumber(name: string): Promise<string | null> {
    const cached = this.stationNumbers.get(name);
    if (cached !== undefined) return cached;
    const xml = await this.fetchXml(`/station/${encodeURIComponent(name)}`);
    const match = /<station\b([^>]*)>/.exec(xml ?? '');
    const eva = match ? (attributes(match[1]!).eva ?? null) : null;
    this.stationNumbers.set(name, eva);
    return eva;
  }

  async refresh(eva: string, stop: StationStop): Promise<StationStop> {
    const changes = await this.get(`/fchg/${eva}`, CHANGES_TTL_MS);
    return applyChange(
      stop,
      changes.find((c) => c.id === stop.id),
    );
  }

  private async get(path: string, ttlMs: number): Promise<RawStop[]> {
    const hit = this.cache.get(path, ttlMs);
    if (hit) return hit;
    const xml = await this.fetchXml(path);
    const stops = xml ? parseTimetable(xml) : [];
    this.cache.set(path, stops);
    return stops;
  }

  /** Null when the API has nothing for this path (404, e.g. no trains at night). */
  private async fetchXml(path: string): Promise<string | null> {
    const now = this.now();
    this.calls = this.calls.filter((t) => now - t < 60_000);
    if (this.calls.length >= MAX_CALLS_PER_MINUTE) throw new RailLimitError();
    this.calls.push(now);

    const res = await this.fetchFn(BASE + path, {
      headers: {
        'DB-Client-Id': this.clientId,
        'DB-Api-Key': this.apiKey,
        accept: 'application/xml',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`DB Timetables responded ${res.status}`);
    return res.text();
  }
}
