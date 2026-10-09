'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PlanInput } from '@/planner/service';
import type { PlanView } from '@/planner/view';
import { generatePlanAction, savePlanAction } from './actions';
import { PlanResult } from './plan-result';

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
  const [pending, startTransition] = useTransition();

  function run(input: PlanInput) {
    setMessage(null);
    startTransition(async () => {
      const result = await generatePlanAction(input);
      if (!result.ok) return setMessage(result.error);
      setCurrent({ input, view: result.data });
    });
  }

  return {
    current,
    pending,
    message,
    start(input: PlanInput) {
      setExcluded([]);
      run(input);
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
      run({ ...current.input, excludeActivityIds: next, keep: undefined, slots: undefined });
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
    save() {
      if (!current) return;
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
  if (!session.current) return null;
  return (
    <PlanResult
      plan={session.current.view}
      pending={session.pending}
      onRerollItem={session.rerollItem}
      onSwap={session.swap}
    >
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
  );
}
