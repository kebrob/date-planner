'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { ChatTurn } from '@/ai/chat';
import type { ChatPlan } from '@/chat/service';
import { chatAction, clearChatAction, undoLastChatTurnAction } from './ai-actions';
import { Linkify } from './linkify';

const EXAMPLES = [
  'Something cozy for tonight, max 30 €',
  'Saturday afternoon, rainy – ideas?',
  'Tomorrow 1–10 pm in München, shopping for sure, dinner after',
];

/** Natural-language planning with Claude; plans are handed to the shared result area. */
export function AskClaude({
  initial,
  enabled,
  onPlans,
  initialQuery,
}: {
  initial: ChatTurn[];
  enabled: boolean;
  onPlans: (plans: ChatPlan[]) => void;
  /** Sent once on load, e.g. from the home screen's ask bar. */
  initialQuery?: string;
}) {
  const [entries, setEntries] = useState<ChatTurn[]>(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastUserIndex = entries.map((e) => e.role).lastIndexOf('user');

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
      setEntries((e) => [...e, { role: 'assistant', text: result.data.text }]);
      if (result.data.plans.length > 0) onPlans(result.data.plans);
    });
  };

  const sentInitial = useRef(false);
  useEffect(() => {
    if (initialQuery && enabled && !sentInitial.current) {
      sentInitial.current = true;
      send(initialQuery);
    }
    // Send once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Puts the last question back into the input and drops it (and its answer) from the history. */
  const editLast = () => {
    const last = entries[lastUserIndex];
    if (!last || pending) return;
    const answered = entries.slice(lastUserIndex + 1).some((e) => e.role === 'assistant');
    startTransition(async () => {
      // Failed requests were never stored, so only answered turns need a server-side undo.
      if (answered) await undoLastChatTurnAction();
      setEntries((e) => e.slice(0, lastUserIndex));
      setDraft(last.text);
      setError(null);
    });
  };

  return (
    <section className="flex flex-col gap-3">
      {entries.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-mist underline hover:text-ink"
              onClick={() =>
                confirm('Clear the conversation?') &&
                startTransition(async () => {
                  await clearChatAction();
                  setEntries([]);
                })
              }
            >
              Clear conversation
            </button>
          </div>
          <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {entries.map((entry, i) => (
              <li key={i} className={entry.role === 'user' ? 'self-end' : 'self-stretch'}>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm ${
                    entry.role === 'user' ? 'bg-ink text-white' : 'bg-cream'
                  }`}
                >
                  <Linkify text={entry.text} />
                </div>
                {i === lastUserIndex && !pending && (
                  <button
                    type="button"
                    onClick={editLast}
                    className="mt-1 block w-full text-right text-xs text-mist underline hover:text-ink"
                  >
                    Edit
                  </button>
                )}
              </li>
            ))}
            {pending && (
              <li className="text-sm text-mist">Claude is thinking… (can take up to a minute)</li>
            )}
          </ol>
        </div>
      )}

      {entries.length === 0 && enabled && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => send(e)}
              className="rounded-full border border-line px-3 py-1.5 text-left text-xs hover:border-butter-deep"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2 text-sm"
          rows={2}
          value={draft}
          maxLength={1000}
          disabled={!enabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder={
            enabled
              ? 'Describe your date – when, where, budget, mood …'
              : 'Claude is disabled (AI_ENABLED=false) – use the filters below.'
          }
        />
        <button
          className="rounded-xl bg-ink px-4 text-sm text-white hover:bg-ink/85 disabled:opacity-50"
          disabled={pending || !enabled || draft.trim() === ''}
        >
          Ask
        </button>
      </form>
    </section>
  );
}
