'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { fromLocal, toLocalTime } from '@/lib/time';
import type { ChosenStopInput, PlanInput } from '@/planner/service';
import type { PlanView } from '@/planner/view';
import { generatePlanAction, savePlanAction } from './actions';
import { PlanResult } from './plan-result';
import { PlanningAnimation } from './planning-animation';
import { PlanEditPickers } from './plan-edit-pickers';
import { Toast } from './toast';

export type CurrentPlan = { input: PlanInput; view: PlanView };

function keepAll(view: PlanView) {
  return Object.fromEntries(
    view.items.map((item, i) => [
      String(i),
      { activityId: item.activityId, place: item.place, alternatives: item.alternatives },
    ]),
  );
}

/** Shared state and actions for a plan on screen: generate, re-roll, swap venues, save. */
export function usePlanSession() {
  const router = useRouter();
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [pending, startTransition] = useTransition();
  // A completely new plan is coming (not just one item), so the old one is hidden meanwhile.
  const [whole, setWhole] = useState(false);
  // Only the latest request may set the plan; an older one can still be on its way.
  const latest = useRef(0);

  /** `note` may explain the new plan, e.g. which kept stops no longer fit. */
  function run(input: PlanInput, newPlan = false, note?: (view: PlanView) => string | null) {
    const request = ++latest.current;
    setMessage(null);
    setNotice(null);
    setWhole(newPlan);
    startTransition(async () => {
      // A dropped connection keeps the current plan instead of ending in the error page.
      const result = await generatePlanAction(input).catch(() => ({
        ok: false as const,
        error: 'Connection problem. Please try again.',
      }));
      if (request !== latest.current) return;
      if (!result.ok) return setMessage(result.error);
      // Only for this run: later re-rolls treat that stop like any other.
      setCurrent({ input: { ...input, anyKindAt: undefined }, view: result.data });
      setNotice(note?.(result.data) ?? null);
    });
  }

  return {
    current,
    pending,
    planning: pending && whole,
    message,
    notice,
    clearNotice,
    start(input: PlanInput) {
      setExcluded([]);
      run(input, true);
    },
    show(plan: CurrentPlan) {
      latest.current++;
      setExcluded([]);
      setMessage(null);
      setCurrent(plan);
    },
    rerollAll() {
      if (!current) return;
      const next = [...new Set([...excluded, ...current.view.items.map((i) => i.activityId)])];
      setExcluded(next);
      run({ ...current.input, excludeActivityIds: next, keep: undefined, slots: undefined }, true);
    },
    rerollItem(index: number) {
      if (!current) return;
      const next = [...new Set([...excluded, current.view.items[index]!.activityId])];
      setExcluded(next);
      const keep = keepAll(current.view);
      delete keep[String(index)];
      run({
        ...current.input,
        excludeActivityIds: next,
        keep,
        slots: current.view.items.map((i) => i.slot),
      });
    },
    swap(index: number, placeId: string) {
      if (!current) return;
      const item = current.view.items[index]!;
      const chosen = item.alternatives.find((p) => p.id === placeId);
      if (!chosen) return;
      const keep = keepAll(current.view);
      keep[String(index)] = {
        activityId: item.activityId,
        place: chosen,
        alternatives: [
          ...(item.place ? [item.place] : []),
          ...item.alternatives.filter((p) => p.id !== placeId),
        ],
      };
      run({
        ...current.input,
        excludeActivityIds: excluded,
        keep,
        slots: current.view.items.map((i) => i.slot),
      });
    },
    /**
     * Adds a stop before the item at `position` (or at the end); `stop` null lets the planner
     * pick. The stop after the gap keeps its start, so the new one fills the gap.
     */
    addStop(position: number, stop: ChosenStopInput | null) {
      if (!current) return;
      const items = current.view.items;
      const shifted = Object.fromEntries(
        Object.entries(keepAll(current.view)).map(([i, k]) => {
          const index = Number(i) >= position ? Number(i) + 1 : Number(i);
          const startTime =
            Number(i) === position ? toLocalTime(new Date(items[position]!.start)) : undefined;
          return [String(index), startTime ? { ...k, startTime } : k];
        }),
      );
      const slots = items.map((i) => i.slot);
      slots.splice(position, 0, 'main');
      const chosen = (current.input.chosen ?? []).map((c) =>
        c.index !== null && c.index >= position ? { ...c, index: c.index + 1 } : c,
      );
      run(
        {
          ...current.input,
          excludeActivityIds: excluded,
          keep: shifted,
          slots,
          anyKindAt: stop ? undefined : [position],
          chosen: stop ? [...chosen, { ...stop, startTime: null, index: position }] : chosen,
        },
        false,
        (view) =>
          view.items.length > items.length ? null : 'Nothing fits into that gap. Try another idea.',
      );
    },
    /** `keep`: other stops stay, times move; `around`: re-plan everything around the new stop. */
    replace(index: number, stop: ChosenStopInput, mode: 'keep' | 'around') {
      if (!current) return;
      // The replaced stop stays out, even if it was chosen for a set time.
      const replaced = current.view.items[index]!.activityId;
      const next = [...new Set([...excluded, replaced])];
      setExcluded(next);
      const others = (current.input.chosen ?? []).filter((c) => c.index !== index);
      if (mode === 'keep') {
        const keep = keepAll(current.view);
        delete keep[String(index)];
        const keptTitles = current.view.items.filter((_, i) => i !== index).map((i) => i.title);
        run(
          {
            ...current.input,
            excludeActivityIds: next,
            keep,
            slots: current.view.items.map((i) => i.slot),
            chosen: [...others, { ...stop, startTime: null, index }],
          },
          false,
          (view) => {
            const dropped = keptTitles.filter((t) => !view.items.some((i) => i.title === t));
            return dropped.length > 0
              ? `${dropped.join(' and ')} no longer ${dropped.length > 1 ? 'fit' : 'fits'} and ${dropped.length > 1 ? 'were' : 'was'} left out.`
              : null;
          },
        );
      } else {
        const startTime = toLocalTime(new Date(current.view.items[index]!.start));
        run(
          {
            ...current.input,
            excludeActivityIds: next,
            keep: undefined,
            slots: undefined,
            chosen: [
              ...others.filter((c) => c.index === null),
              { ...stop, startTime, index: null },
            ],
          },
          true,
        );
      }
    },
    save() {
      if (!current) return;
      setWhole(false);
      startTransition(async () => {
        const result = await savePlanAction(current.input, current.view);
        if (!result.ok) return setMessage(result.error);
        router.push(`/plans/${result.data}`);
      });
    },
  };
}

export type PlanSession = ReturnType<typeof usePlanSession>;

// Plans ready sooner than this skip the animation, so it never just flashes.
const ANIMATION_DELAY_MS = 400;

/** Shows the animation once planning takes a moment, and keeps it until it has finished. */
function usePlanningAnimation(planning: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!planning) return;
    const timer = setTimeout(() => setVisible(true), ANIMATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [planning]);
  const hide = useCallback(() => setVisible(false), []);
  return { visible, hide };
}

/** The plan on screen with re-roll and save actions. */
export function SessionResult({ session }: { session: PlanSession }) {
  const [choosing, setChoosing] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const animation = usePlanningAnimation(session.planning);
  if (animation.visible) {
    return <PlanningAnimation done={!session.planning} onFinished={animation.hide} />;
  }
  if (session.planning || !session.current) return null;
  const { view, input } = session.current;
  return (
    <>
      <Toast message={session.notice} onDone={session.clearNotice} />
      <PlanResult
        plan={view}
        pending={session.pending}
        onRerollItem={session.rerollItem}
        onSwap={session.swap}
        onChooseItem={setChoosing}
        onAddStop={setAdding}
        window={{
          start: fromLocal(input.date, input.startTime),
          end: fromLocal(input.endDate, input.endTime),
        }}
      >
        <PlanEditPickers
          items={view.items}
          area={input.areaPoint ?? null}
          adding={adding}
          choosing={choosing}
          onClose={() => {
            setAdding(null);
            setChoosing(null);
          }}
          onAdd={session.addStop}
          onReplace={session.replace}
        />
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={session.rerollAll}
            disabled={session.pending}
            className="rounded-full border border-line bg-white px-5 py-3.5 text-sm font-medium hover:bg-cream disabled:opacity-50"
          >
            {session.pending ? 'Planning…' : 'Something else'}
          </button>
          <button
            type="button"
            onClick={session.save}
            disabled={session.pending}
            className="rounded-full bg-ink px-5 py-3.5 text-sm font-medium text-white hover:bg-ink/85 disabled:opacity-50"
          >
            Save this date
          </button>
        </div>
      </PlanResult>
    </>
  );
}
