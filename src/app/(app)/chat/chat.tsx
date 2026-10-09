'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ChatTurn } from '@/ai/chat';
import type { ChatPlan } from '@/chat/service';
import { savePlanAction } from '../actions';
import { chatAction, clearChatAction } from '../ai-actions';
import { Linkify } from '../linkify';
import { PlanResult } from '../plan-result';

type Entry = ChatTurn & { plans?: ChatPlan[] };

const EXAMPLES = [
  'Plan something cozy for tonight, max 30 €',
  'What can we do on Saturday if it rains?',
  'Give us a romantic evening in München with Italian food',
];

export function Chat({ initial, enabled }: { initial: ChatTurn[]; enabled: boolean }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setDraft('');
    setEntries((e) => [...e, { role: 'user', text: message }]);
    startTransition(async () => {
      const result = await chatAction(message);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntries((e) => [
        ...e,
        { role: 'assistant', text: result.data.text, plans: result.data.plans },
      ]);
    });
  };

  const save = (plan: ChatPlan) =>
    startTransition(async () => {
      const result = await savePlanAction(plan.input, plan.view);
      if (!result.ok) return setError(result.error);
      router.push(`/plans/${result.data}`);
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ask Claude</h1>
        {entries.length > 0 && (
          <button
            type="button"
            className="text-sm text-stone-500 underline"
            onClick={() =>
              confirm('Clear the conversation?') &&
              startTransition(async () => {
                await clearChatAction();
                setEntries([]);
              })
            }
          >
            Clear
          </button>
        )}
      </div>

      {!enabled && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Claude is disabled (AI_ENABLED=false). The planner still works without it.
        </p>
      )}

      {entries.length === 0 && enabled && (
        <div className="flex flex-col gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => send(e)}
              className="rounded-xl border border-stone-300 px-3 py-2 text-left text-sm dark:border-stone-700"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {entries.map((entry, i) => (
          <li key={i} className={entry.role === 'user' ? 'self-end' : 'self-stretch'}>
            <div
              className={`rounded-2xl px-4 py-2 text-sm ${
                entry.role === 'user'
                  ? 'bg-rose-600 text-white'
                  : 'bg-white shadow-sm dark:bg-stone-900'
              }`}
            >
              <Linkify text={entry.text} />
            </div>
            {entry.plans?.map((plan, j) => (
              <div key={j} className="mt-3">
                <PlanResult plan={plan.view} pending={pending}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => save(plan)}
                    className="rounded-xl bg-stone-900 px-4 py-3 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                  >
                    Save this plan
                  </button>
                </PlanResult>
              </div>
            ))}
          </li>
        ))}
        {pending && (
          <li className="text-sm text-stone-500">Claude is thinking… (can take up to a minute)</li>
        )}
      </ol>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <form
        className="sticky bottom-20 flex gap-2 sm:bottom-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          className="flex-1 rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm dark:border-stone-700 dark:bg-stone-950"
          value={draft}
          maxLength={1000}
          disabled={!enabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask for ideas or a plan…"
        />
        <button
          className="rounded-xl bg-rose-600 px-4 text-sm text-white disabled:opacity-50"
          disabled={pending || !enabled || draft.trim() === ''}
        >
          Send
        </button>
      </form>
    </div>
  );
}
