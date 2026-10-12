'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toLocalTime } from '@/lib/time';
import type { ChosenStopInput, PlanInput } from '@/planner/service';
import type { PlanView } from '@/planner/view';
import { generatePlanAction, savePlanAction } from './actions';
import { PlanResult } from './plan-result';
import { PlanningAnimation } from './planning-animation';
import { StopPicker } from './stop-picker';

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
  const [pending, startTransition] = useTransition();
  // A completely new plan is coming (not just one item), so the old one is hidden meanwhile.
  const [whole, setWhole] = useState(false);

  /** `note` may explain the new plan, e.g. which kept stops no longer fit. */
  function run(input: PlanInput, newPlan = false, note?: (view: PlanView) => string | null) {
    setMessage(null);
    setNotice(null);
    setWhole(newPlan);
    startTransition(async () => {
      const result = await generatePlanAction(input);
      if (!result.ok) return setMessage(result.error);
      setCurrent({ input, view: result.data });
      setNotice(note?.(result.data) ?? null);
    });
  }

  return {
    current,
    pending,
    planning: pending && whole,
    message,
    notice,
    start(input: PlanInput) {
      setExcluded([]);
      run(input, true);
    },
    show(plan: CurrentPlan) {
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

/** The plan on screen with re-roll and save actions. */
export function SessionResult({ session }: { session: PlanSession }) {
  const [choosing, setChoosing] = useState<number | null>(null);
  if (session.planning) return <PlanningAnimation />;
  if (!session.current) return null;
  const view = session.current.view;
  const near = (index: number) =>
    view.items[index]?.place?.location ?? session.current?.input.areaPoint ?? null;
  return (
    <>
      {session.notice && <p className="text-sm text-amber-700">{session.notice}</p>}
      <PlanResult
        plan={view}
        pending={session.pending}
        onRerollItem={session.rerollItem}
        onSwap={session.swap}
        onChooseItem={setChoosing}
      >
        {choosing !== null && (
          <StopPicker
            heading={`Instead of ${view.items[choosing]?.title.toLowerCase() ?? 'this'}`}
            near={near(choosing)}
            askMode
            onClose={() => setChoosing(null)}
            onPick={(picked, mode) => {
              session.replace(choosing, picked.stop, mode);
              setChoosing(null);
            }}
          />
        )}
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
