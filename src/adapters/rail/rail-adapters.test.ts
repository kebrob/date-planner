import { describe, expect, it, vi } from 'vitest';
import { fromLocal } from '@/lib/time';
import { DbTimetablesProvider, parseTime, parseTimetable, RailLimitError } from './db-timetables';
import { StationListFinder } from './station-list';

const PLAN = `<?xml version='1.0' encoding='UTF-8'?>
<timetable station='Rosenheim'>
  <s id="-123-2610101650-4">
    <tl f="N" t="p" o="800734" c="RB" n="12345"/>
    <ar pt="2610101710" pp="2" l="RB54" ppth="Salzburg Hbf|Prien am Chiemsee"/>
    <dp pt="2610101712" pp="2" l="RB54" ppth="Großkarolinenfeld|München Ost|München Hbf"/>
  </s>
  <s id="-456-2610101700-1">
    <tl f="F" t="p" o="80" c="ICE" n="511"/>
    <dp pt="2610101730" pp="1" ppth="München Hbf &amp; more"/>
  </s>
</timetable>`;

const CHANGES = `<timetable station="Rosenheim" eva="8000320">
  <s id="-123-2610101650-4" eva="8000320">
    <dp ct="2610101717" cp="3"><m id="r1" t="d" c="2"/></dp>
  </s>
</timetable>`;

describe('parseTimetable', () => {
  it('reads stops with train, arrival and departure attributes', () => {
    const stops = parseTimetable(PLAN);
    expect(stops).toHaveLength(2);
    expect(stops[0]).toMatchObject({
      id: '-123-2610101650-4',
      tl: { c: 'RB', n: '12345' },
      dp: { pt: '2610101712', pp: '2', l: 'RB54' },
    });
    expect(stops[1]!.dp!.ppth).toBe('München Hbf & more');
  });
});

describe('parseTime', () => {
  it('reads German local time, also in summer time', () => {
    expect(parseTime('2610101712')).toEqual(fromLocal('2026-10-10', '17:12'));
    expect(parseTime('2601151712')).toEqual(fromLocal('2026-01-15', '17:12'));
    expect(parseTime('nope')).toBeNull();
  });
});

function response(body: string, status = 200) {
  return new Response(body, { status });
}

describe('DbTimetablesProvider', () => {
  it('merges the planned timetable with realtime changes', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/fchg/') ? response(CHANGES) : response(PLAN),
    );
    const provider = new DbTimetablesProvider('id', 'key', fetchFn);
    const stops = await provider.stops('8000320', fromLocal('2026-10-10', '17:00'), 1);

    const rb = stops.find((s) => s.category === 'RB')!;
    expect(rb.line).toBe('RB 54');
    expect(rb.departure).toMatchObject({
      planned: fromLocal('2026-10-10', '17:12'),
      actual: fromLocal('2026-10-10', '17:17'),
      platform: '3',
      plannedPlatform: '2',
      path: ['Großkarolinenfeld', 'München Ost', 'München Hbf'],
    });
    const headers = fetchFn.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['DB-Client-Id']).toBe('id');
    expect(String(fetchFn.mock.calls[1]![0])).toContain('/plan/8000320/261010/17');
  });

  it('treats a missing hour plan (404) as no trains', async () => {
    const provider = new DbTimetablesProvider('id', 'key', async (url) =>
      String(url).includes('/fchg/') ? response('<timetable/>') : response('', 404),
    );
    expect(await provider.stops('8000320', fromLocal('2026-10-10', '03:00'), 1)).toEqual([]);
  });

  it('caches plans and stops before the per-minute quota', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => response(PLAN));
    const provider = new DbTimetablesProvider('id', 'key', fetchFn, () => 0);
    const at = fromLocal('2026-10-10', '17:00');
    await provider.stops('8000320', at, 1);
    await provider.stops('8000320', at, 1);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await expect(
      Promise.all(Array.from({ length: 30 }, (_, i) => provider.stops(`80${i}`, at, 1))),
    ).rejects.toBeInstanceOf(RailLimitError);
  });
});

describe('StationListFinder', () => {
  it('returns stations within the radius, closest first', async () => {
    const finder = new StationListFinder([
      { eva: '8000262', name: 'München Ost', location: { lat: 48.127, lng: 11.605 } },
      { eva: '8000261', name: 'München Hbf', location: { lat: 48.14, lng: 11.558 } },
      { eva: '8000320', name: 'Rosenheim', location: { lat: 47.85, lng: 12.119 } },
    ]);
    const stations = await finder.near({ lat: 48.139, lng: 11.56 }, 4);
    expect(stations.map((s) => s.eva)).toEqual(['8000261', '8000262']);
  });

  it('ships the DB station list', async () => {
    const [rosenheim] = await new StationListFinder().near({ lat: 47.85, lng: 12.12 }, 1);
    expect(rosenheim).toMatchObject({ eva: '8000320', name: 'Rosenheim' });
  });
});
