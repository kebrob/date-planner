'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PlanEdit, SavedPlanView, Window } from '@/planner/saved';
import {
  deletePlanAction,
  editPlanAction,
  planAgainAction,
  updatePlanMetaAction,
} from '../../actions';
import { PlanResult } from '../../plan-result';

const field = 'rounded-lg border border-line bg-transparent px-3 py-2';
const button = 'rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-50 hover:bg-cream';

function WindowFields({ value, onChange }: { value: Window; onChange: (w: Window) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <input
        type="date"
        className={field}
        value={value.date}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
      />
      <input
        type="time"
        className={field}
        value={value.startTime}
        onChange={(e) => onChange({ ...value, startTime: e.target.value })}
      />
      <input
        type="date"
        className={field}
        value={value.endDate}
        onChange={(e) => onChange({ ...value, endDate: e.target.value })}
      />
      <input
        type="time"
        className={field}
        value={value.endTime}
        onChange={(e) => onChange({ ...value, endTime: e.target.value })}
      />
    </div>
  );
}

export function SavedPlan({ plan }: { plan: SavedPlanView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState(plan.note ?? '');
  const [window, setWindow] = useState<Window>(plan.window);
  const [panel, setPanel] = useState<'none' | 'reschedule' | 'again'>('none');

  const run = (action: () => Promise<void>) => {
    setMessage(null);
    startTransition(action);
  };

  const edit = (change: PlanEdit) =>
    run(async () => {
      const result = await editPlanAction(plan.id, change);
      if (!result.ok) return setMessage(result.error);
      if (result.data > 0) {
        setMessage(
          `${result.data} item(s) no longer fit (e.g. closed) and were replaced or dropped.`,
        );
      }
      setPanel('none');
      router.refresh();
    });

  const editable = !plan.isPast;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className="text-sm text-mist">
          {plan.isPast ? 'Past date' : 'Upcoming'}
          {plan.area ? ` · ${plan.area}` : ''}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              await updatePlanMetaAction(plan.id, { isFavorite: !plan.isFavorite });
              router.refresh();
            })
          }
          className="text-2xl"
          aria-label={plan.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
        >
          {plan.isFavorite ? '★' : '☆'}
        </button>
      </div>

      <PlanResult
        plan={plan}
        pending={pending}
        onRerollItem={editable ? (index) => edit({ type: 'reroll', index }) : undefined}
        onRemoveItem={editable ? (index) => edit({ type: 'remove', index }) : undefined}
        onSwap={editable ? (index, placeId) => edit({ type: 'swap', index, placeId }) : undefined}
      />

      <label className="flex flex-col gap-1 text-sm">
        Note
        <textarea
          className={field}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. table booked for 19:00"
        />
        {note !== (plan.note ?? '') && (
          <button
            type="button"
            disabled={pending}
            className={`${button} self-end`}
            onClick={() =>
              run(async () => {
                const result = await updatePlanMetaAction(plan.id, { note });
                setMessage(result.ok ? 'Note saved.' : result.error);
                router.refresh();
              })
            }
          >
            Save note
          </button>
        )}
      </label>

      {message && <p className="text-center text-sm text-mist">{message}</p>}

      {panel !== 'none' && (
        <div className="flex flex-col gap-3 rounded-3xl bg-white p-5 ring-1 ring-line">
          <p className="text-sm font-medium">
            {panel === 'reschedule' ? 'Move this date to' : 'Plan this date again on'}
          </p>
          <WindowFields value={window} onChange={setWindow} />
          <button
            type="button"
            disabled={pending}
            className="rounded-full bg-ink px-5 py-3.5 text-white disabled:opacity-50 hover:bg-ink/85"
            onClick={() =>
              panel === 'reschedule'
                ? edit({ type: 'reschedule', window })
                : run(async () => {
                    const result = await planAgainAction(plan.id, window);
                    if (!result.ok) return setMessage(result.error);
                    router.push(`/plans/${result.data}`);
                  })
            }
          >
            {pending ? 'Planning…' : panel === 'reschedule' ? 'Move' : 'Create plan'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {editable && (
          <button type="button" className={button} onClick={() => setPanel('reschedule')}>
            Change date
          </button>
        )}
        <button type="button" className={button} onClick={() => setPanel('again')}>
          Plan again
        </button>
        <button
          type="button"
          disabled={pending}
          className={`${button} text-red-600`}
          onClick={() => {
            if (!confirm('Delete this plan?')) return;
            run(async () => {
              const result = await deletePlanAction(plan.id);
              if (!result.ok) return setMessage(result.error);
              router.push('/plans');
            });
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
