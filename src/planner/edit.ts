import { getPlaceDetailsProvider } from '@/adapters';
import { MAX_ITEMS } from '@/core/planner/build-plan';
import { addMinutes, fromLocal, minutesBetween, toLocalTime } from '@/lib/time';
import type { Place } from '@/ports/places';
import {
  baseInput,
  homeLocation,
  isFullPlace,
  loadPlan,
  replacePlan,
  savePlan,
  windowOf,
  type ItemRow,
  type PlanRow,
  type Window,
} from './saved';
import { generatePlan, savedInput, type ChosenStopInput, type PlanInput } from './service';
import { toPlanView, type PlanView } from './view';

export class PlanNotEditableError extends Error {}
/** Nothing fitted into the gap a stop was added to. */
export class StopNotAddedError extends Error {}

export type PlanEdit =
  | { type: 'reroll'; index: number }
  | { type: 'remove'; index: number }
  | { type: 'swap'; index: number; placeId: string }
  /** New date/time and, optionally, a new transport; stops and venues stay where possible. */
  | { type: 'reschedule'; window: Window; transport?: PlanInput['transport'] }
  /** `keep`: other stops stay, times move; `around`: re-plan the rest around the chosen stop. */
  | { type: 'replace'; index: number; stop: ChosenStopInput; mode: 'keep' | 'around' }
  /** New stop before the item at `position` (or at the end); `stop` null = planner's pick. */
  | { type: 'add'; position: number; stop: ChosenStopInput | null };

type KeepEntry = {
  activityId: string;
  place: Place | null;
  alternatives: Place[];
  /** Stays at this start ("HH:MM"). */
  startTime?: string;
};

function keepOf(item: ItemRow): KeepEntry | null {
  if (!item.activityId) return null;
  if (item.placeId && !isFullPlace(item.place)) return null;
  return {
    activityId: item.activityId,
    place: isFullPlace(item.place) ? item.place : null,
    alternatives: (item.alternatives as Place[]) ?? [],
  };
}

/**
 * One-off stops (no stored idea, but a venue) cannot be kept like ideas; they are re-pinned from
 * the saved item so that editing other stops does not lose them.
 */
export function oneOffStop(item: ItemRow, index: number): ChosenStopInput | null {
  if (item.activityId || !isFullPlace(item.place)) return null;
  const slot = item.slot as 'main' | 'meal' | 'snack';
  return {
    activityId: null,
    custom: {
      title: item.title,
      kind: slot === 'main' ? 'activity' : slot,
      durationMinutes: Math.max(15, minutesBetween(item.startsAt, item.endsAt)),
      costEur: item.costEur,
      query: item.placeName ?? item.title,
    },
    place: item.place,
    startTime: null,
    index,
  };
}

function keepRecord(entries: (KeepEntry | null)[]) {
  return Object.fromEntries(
    entries.flatMap((e, i) => (e ? [[String(i), e] as const] : [])),
  ) as NonNullable<PlanInput['keep']>;
}

/**
 * One-off stops of a saved plan to pin again. Kept ideas stay through `keep`, and stops fixed to a
 * time come back through the saved input, so only the others are re-pinned. `skip`: positions that
 * get something new; `positionOf`: where a stop ends up in the new layout.
 */
function oneOffsToRepin(
  rows: ItemRow[],
  entries: (KeepEntry | null)[],
  fixed: PlanInput['chosen'],
  {
    skip = () => false,
    positionOf = (i) => i,
  }: {
    skip?: (index: number) => boolean;
    positionOf?: (index: number) => number;
  } = {},
): ChosenStopInput[] {
  const fixedTitles = new Set((fixed ?? []).flatMap((c) => (c.custom ? [c.custom.title] : [])));
  return rows.flatMap((row, i) => {
    if (entries[i] || fixedTitles.has(row.title) || skip(i)) return [];
    const stop = oneOffStop(row, positionOf(i));
    return stop ? [stop] : [];
  });
}

/** Re-plans a saved, upcoming plan; returns the titles of kept stops that no longer fit. */
export async function editPlan(id: string, edit: PlanEdit, now = new Date()): Promise<string[]> {
  const { plan, items } = await loadPlan(id);
  if (plan.endsAt < now) throw new PlanNotEditableError();
  const base = baseInput(plan);
  if (edit.type === 'add') return addStop(id, plan, items, base, edit.position, edit.stop);
  if (edit.type !== 'reschedule' && !items[edit.index]) throw new PlanNotEditableError();
  // A re-rolled, removed or replaced stop that was chosen for a set time is no longer fixed.
  if (edit.type !== 'reschedule' && edit.type !== 'swap') {
    const target = items[edit.index]!;
    base.chosen = base.chosen?.filter(
      (c) =>
        (c.activityId ?? null) !== target.activityId ||
        (!c.activityId && c.custom?.title !== target.title),
    );
    if (base.chosen?.length === 0) delete base.chosen;
  }

  let rows = items;
  let entries = items.map(keepOf);
  let window = windowOf(plan, base);
  const exclude: string[] = [];
  let chosen: ChosenStopInput[] | undefined;
  // Moving a plan leaves stops out that no longer fit instead of suggesting others.
  let leaveOut = false;

  switch (edit.type) {
    case 'reroll': {
      const target = items[edit.index]!;
      if (target.activityId) exclude.push(target.activityId);
      entries[edit.index] = null;
      break;
    }
    case 'remove': {
      if (items.length <= 1) throw new PlanNotEditableError();
      const removed = items[edit.index]!;
      if (removed.activityId) exclude.push(removed.activityId);
      rows = items.filter((_, i) => i !== edit.index);
      entries = rows.map(keepOf);
      // The user wants less: free time stays free, now and in later edits.
      base.fillGaps = false;
      break;
    }
    case 'swap': {
      const entry = entries[edit.index];
      const alternative = entry?.alternatives.find((p) => p.id === edit.placeId);
      if (!entry || !alternative) throw new PlanNotEditableError();
      entries[edit.index] = {
        ...entry,
        place: alternative,
        alternatives: [
          ...(entry.place ? [entry.place] : []),
          ...entry.alternatives.filter((p) => p.id !== edit.placeId),
        ],
      };
      break;
    }
    case 'reschedule': {
      window = edit.window;
      if (edit.transport) base.transport = edit.transport;
      // Stops keep their time of day where the new window allows it; extra time stays free.
      const start = fromLocal(window.date, window.startTime);
      const end = fromLocal(window.endDate, window.endTime);
      items.forEach((item, i) => {
        const entry = entries[i];
        if (!entry) return;
        const time = toLocalTime(item.startsAt);
        const sameDay = fromLocal(window.date, time);
        const at = sameDay < start ? fromLocal(window.endDate, time) : sameDay;
        const minutes = minutesBetween(item.startsAt, item.endsAt);
        if (at >= start && addMinutes(at, minutes) <= end)
          entries[i] = { ...entry, startTime: time };
      });
      base.fillGaps = false;
      leaveOut = true;
      break;
    }
    case 'replace':
      if (edit.mode === 'around') {
        // Only the chosen stop is fixed, at the time the replaced one started.
        const input: PlanInput = {
          ...base,
          ...window,
          chosen: [
            ...(base.chosen ?? []),
            { ...edit.stop, startTime: toLocalTime(items[edit.index]!.startsAt), index: null },
          ],
          excludeActivityIds: [],
        };
        const result = await generatePlan(input);
        const view = toPlanView(result.plan, await homeLocation(), result.area);
        await replacePlan(id, savedInput(input), view);
        return [];
      }
      entries[edit.index] = null;
      chosen = [{ ...edit.stop, startTime: null, index: edit.index }];
      break;
  }

  const oneOffs = oneOffsToRepin(rows, entries, base.chosen, {
    skip: (i) =>
      Boolean(chosen?.some((c) => c.index === i)) || (edit.type === 'reroll' && i === edit.index),
  });
  const input: PlanInput = {
    ...base,
    ...window,
    slots: rows.map((r) => r.slot as 'main' | 'meal' | 'snack'),
    keep: keepRecord(entries),
    chosen: [...(base.chosen ?? []), ...(chosen ?? []), ...oneOffs],
    excludeActivityIds: exclude,
    replaceUnfit: leaveOut ? false : undefined,
  };
  const result = await generatePlan(input);
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  await replacePlan(id, savedInput(input), view);
  return unfitTitles(rows, entries, view);
}

/** Kept stops that could not stay as they were (e.g. no time left, venue closed then). */
function unfitTitles(rows: ItemRow[], entries: (KeepEntry | null)[], view: PlanView): string[] {
  return rows.flatMap((row, i) => {
    const e = entries[i];
    const stays = view.items.some(
      (item) => item.activityId === e?.activityId && item.place?.id === e?.place?.id,
    );
    return e && !stays ? [row.title] : [];
  });
}

/**
 * Adds a stop at a position: the stops stay, the one after the gap keeps its start so the new
 * one fills the gap. Throws when nothing fits there.
 */
async function addStop(
  id: string,
  plan: PlanRow,
  items: ItemRow[],
  base: PlanInput,
  position: number,
  stop: ChosenStopInput | null,
): Promise<string[]> {
  if (position < 0 || position > items.length || items.length >= MAX_ITEMS) {
    throw new PlanNotEditableError();
  }
  const entries = items.map(keepOf);
  const oneOffs = oneOffsToRepin(items, entries, base.chosen, {
    positionOf: (i) => (i >= position ? i + 1 : i),
  });
  entries.splice(position, 0, null);
  const keep = keepRecord(entries);
  const next = keep[String(position + 1)];
  if (next) next.startTime = toLocalTime(items[position]!.startsAt);
  const slots = items.map((r) => r.slot as 'main' | 'meal' | 'snack');
  slots.splice(position, 0, 'main');

  const input: PlanInput = {
    ...base,
    ...windowOf(plan, base),
    slots,
    keep,
    anyKindAt: stop ? undefined : [position],
    chosen: [
      ...(base.chosen ?? []),
      ...(stop ? [{ ...stop, startTime: null, index: position }] : []),
      ...oneOffs,
    ],
    excludeActivityIds: [],
  };
  const result = await generatePlan(input);
  if (result.plan.items.length <= items.length) throw new StopNotAddedError();
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  await replacePlan(id, savedInput(input), view);
  return unfitTitles(items, items.map(keepOf), view);
}

/** Creates a new upcoming plan from an existing one (e.g. a favourite) for another date. */
export async function planAgain(id: string, window: Window): Promise<string> {
  const { plan, items } = await loadPlan(id);
  const details = getPlaceDetailsProvider();
  const entries: (KeepEntry | null)[] = [];
  for (const item of items) {
    let entry = keepOf(item);
    if (!entry && item.activityId && item.placeProvider === 'google' && item.placeId && details) {
      // Archived Google place: re-fetch its data (one guarded lookup).
      const place = await details.details(item.placeId).catch(() => null);
      if (place) entry = { activityId: item.activityId, place, alternatives: [] };
    }
    entries.push(entry);
  }
  const fixed = baseInput(plan).chosen ?? [];
  const input: PlanInput = {
    ...baseInput(plan),
    ...window,
    slots: items.map((r) => r.slot as 'main' | 'meal' | 'snack'),
    keep: keepRecord(entries),
    chosen: [...fixed, ...oneOffsToRepin(items, entries, fixed)],
    excludeActivityIds: [],
  };
  const result = await generatePlan(input);
  const view = toPlanView(result.plan, await homeLocation(), result.area);
  return savePlan({ ...baseInput(plan), ...window }, view);
}
