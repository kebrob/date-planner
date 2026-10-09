'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ChatTurn } from '@/ai/chat';
import type { ChatPlan } from '@/chat/service';
import type { PlanInput } from '@/planner/service';
import type { PlanView } from '@/planner/view';
import { generatePlanAction, savePlanAction } from './actions';
import { AskClaude } from './ask-claude';
import { Filters, type PlannerDefaults } from './filters';
import { PlanResult } from './plan-result';

type Current = { input: PlanInput; view: PlanView };

const card = 'flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900';

function keepAll(view: PlanView) {
  return Object.fromEntries(
    view.items.map((item, i) => [
      String(i),
      { activityId: item.activityId, place: item.place, alternatives: item.alternatives },
    ]),
  );
}

/**
 * Plan tab: Claude (natural language) and the filter form produce plans into one result area,
 * where they can be re-rolled, adjusted and saved the same way.
 */
export function PlanWorkspace({
  defaults,
  chatHistory,
  aiEnabled,
}: {
  defaults: PlannerDefaults;
  chatHistory: ChatTurn[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<Current | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(!aiEnabled);
  const [pending, startTransition] = useTransition();

  function run(input: PlanInput) {
    setMessage(null);
    startTransition(async () => {
      const result = await generatePlanAction(input);
      if (!result.ok) return setMessage(result.error);
      setCurrent({ input, view: result.data });
    });
  }

  const planFromFilters = (input: PlanInput) => {
    setExcluded([]);
    run(input);
  };

  const showClaudePlans = (plans: ChatPlan[]) => {
    const latest = plans.at(-1);
    if (!latest) return;
    setExcluded([]);
    setMessage(null);
    setCurrent(latest);
  };

  const rerollAll = () => {
    if (!current) return;
    const next = [...new Set([...excluded, ...current.view.items.map((i) => i.activityId)])];
    setExcluded(next);
    run({ ...current.input, excludeActivityIds: next, keep: undefined, slots: undefined });
  };

  const rerollItem = (index: number) => {
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
  };

  const swap = (index: number, placeId: string) => {
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
  };

  const accept = () => {
    if (!current) return;
    startTransition(async () => {
      const result = await savePlanAction(current.input, current.view);
      if (!result.ok) return setMessage(result.error);
      router.push(`/plans/${result.data}`);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <h2 className="font-medium">What do you feel like?</h2>
        <AskClaude initial={chatHistory} enabled={aiEnabled} onPlans={showClaudePlans} />
      </div>

      <div className={card}>
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="flex items-center justify-between text-left font-medium hover:text-rose-600"
        >
          <span>
            Plan with filters
            <span className="ml-2 text-xs font-normal text-stone-500">no AI, free &amp; fast</span>
          </span>
          <span aria-hidden>{filtersOpen ? '▴' : '▾'}</span>
        </button>
        {filtersOpen && <Filters defaults={defaults} pending={pending} onPlan={planFromFilters} />}
      </div>

      {message && (
        <p className="text-center text-sm text-stone-600 dark:text-stone-400">{message}</p>
      )}

      {pending && !current && <p className="text-center text-sm text-stone-500">Planning…</p>}

      {current && (
        <PlanResult plan={current.view} pending={pending} onRerollItem={rerollItem} onSwap={swap}>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={rerollAll}
              disabled={pending}
              className="rounded-xl border border-stone-300 px-4 py-3 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              {pending ? 'Planning…' : 'Something else'}
            </button>
            <button
              type="button"
              onClick={accept}
              disabled={pending}
              className="rounded-xl bg-stone-900 px-4 py-3 text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              Let&apos;s do it
            </button>
          </div>
        </PlanResult>
      )}
    </div>
  );
}
