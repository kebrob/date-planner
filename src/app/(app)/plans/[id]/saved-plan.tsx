'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { fromLocal } from '@/lib/time';
import type { PlanEdit } from '@/planner/edit';
import type { SavedPlanView, Window } from '@/planner/saved';
import {
  deletePlanAction,
  editPlanAction,
  planAgainAction,
  updatePlanMetaAction,
} from '../../actions';
import { PlanResult } from '../../plan-result';
import { DateRating, ItemRating } from '../../rating';
import { StopPicker } from '../../stop-picker';
import { Toast } from '../../toast';

const field = 'rounded-lg border border-line bg-transparent px-3 py-2';

const TRANSPORTS: { value: SavedPlanView['transport']; label: string }[] = [
  { value: 'deutschlandticket', label: 'Deutschlandticket' },
  { value: 'car', label: 'Car' },
  { value: 'walk', label: 'On foot' },
];
const button = 'rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-50 hover:bg-cream';
// Fills the row; each button starts at its content width and the rest is shared.
const rowButton = `${button} min-h-11 flex-auto whitespace-nowrap`;

const CONCERNS: Record<NonNullable<SavedPlanView['weatherConcerns'][number]>, string> = {
  rain: 'Rain is now forecast for this one.',
  snow: 'Snow is now forecast for this one.',
  cold: 'It will be colder than this idea needs.',
  hot: 'It will be hotter than this idea suits.',
};

function WindowFields({ value, onChange }: { value: Window; onChange: (w: Window) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <input
        type="date"
        aria-label="Start date"
        className={field}
        value={value.date}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
      />
      <input
        type="time"
        aria-label="Start time"
        className={field}
        value={value.startTime}
        onChange={(e) => onChange({ ...value, startTime: e.target.value })}
      />
      <input
        type="date"
        aria-label="End date"
        className={field}
        value={value.endDate}
        onChange={(e) => onChange({ ...value, endDate: e.target.value })}
      />
      <input
        type="time"
        aria-label="End time"
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
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const fail = (text: string) => setMessage({ text, error: true });
  const inform = (text: string) => setMessage({ text, error: false });
  const [note, setNote] = useState(plan.note ?? '');
  const [window, setWindow] = useState<Window>(plan.window);
  const [panel, setPanel] = useState<'none' | 'reschedule' | 'again'>('none');
  const [transport, setTransport] = useState(plan.transport);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  // Single stops are rated on demand, or right away when some already are.
  const [rateItems, setRateItems] = useState(plan.itemRatings.some((r) => r.rating !== null));

  const run = (action: () => Promise<void>) => {
    setMessage(null);
    startTransition(action);
  };

  const edit = (change: PlanEdit) =>
    run(async () => {
      const result = await editPlanAction(plan.id, change);
      if (!result.ok) return fail(result.error);
      const unfit = result.data;
      if (unfit.length > 0) {
        const names =
          unfit.length > 1 ? `${unfit.slice(0, -1).join(', ')} and ${unfit.at(-1)}` : unfit[0];
        const many = unfit.length > 1;
        inform(
          change.type === 'reschedule'
            ? `${names} didn't fit the new time and ${many ? 'were' : 'was'} left out.`
            : `${names} no longer ${many ? 'fit' : 'fits'} and ${many ? 'were' : 'was'} replaced or left out.`,
        );
      }
      setPanel('none');
      router.refresh();
    });

  const editable = !plan.isPast;
  const rating = plan.canRate && !plan.notHappened;

  const itemExtra = (index: number) => {
    const item = plan.items[index]!;
    const concern = plan.weatherConcerns[index];
    if (!(editable && concern) && !(rating && rateItems)) return null;
    return (
      <>
        {editable && concern && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-amber-700">
            {CONCERNS[concern]}
            <button
              type="button"
              disabled={pending}
              onClick={() => edit({ type: 'reroll', index })}
              className="min-h-11 rounded-full bg-cream px-4 text-sm text-ink hover:bg-butter disabled:opacity-50"
            >
              Swap for something else
            </button>
          </p>
        )}
        {rating && rateItems && (
          <ItemRating
            planId={plan.id}
            position={index}
            activityId={item.activityId}
            hasPlace={Boolean(item.place ?? item.placeName)}
            initial={plan.itemRatings[index]!}
          />
        )}
      </>
    );
  };

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
              const result = await updatePlanMetaAction(plan.id, { isFavorite: !plan.isFavorite });
              if (!result.ok) return fail(result.error);
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
        onChooseItem={editable ? setChoosing : undefined}
        onAddStop={editable ? setAdding : undefined}
        window={{
          start: fromLocal(plan.window.date, plan.window.startTime),
          end: fromLocal(plan.window.endDate, plan.window.endTime),
        }}
        renderItemExtra={itemExtra}
      />

      {adding !== null && (
        <StopPicker
          heading="Add a stop"
          near={
            plan.items[adding - 1]?.place?.location ?? plan.items[adding]?.place?.location ?? null
          }
          onClose={() => setAdding(null)}
          onSurprise={() => {
            const position = adding;
            setAdding(null);
            edit({ type: 'add', position, stop: null });
          }}
          onPick={(picked) => {
            const position = adding;
            setAdding(null);
            edit({ type: 'add', position, stop: picked.stop });
          }}
        />
      )}

      {choosing !== null && (
        <StopPicker
          heading={`Instead of ${plan.items[choosing]?.title.toLowerCase() ?? 'this'}`}
          near={plan.items[choosing]?.place?.location ?? null}
          askMode
          onClose={() => setChoosing(null)}
          onPick={(picked, mode) => {
            const index = choosing;
            setChoosing(null);
            edit({ type: 'replace', index, stop: picked.stop, mode });
          }}
        />
      )}

      {plan.canRate && <DateRating plan={plan} showItems={rateItems} onShowItems={setRateItems} />}

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
                if (result.ok) inform('Note saved.');
                else fail(result.error);
                router.refresh();
              })
            }
          >
            Save note
          </button>
        )}
      </label>

      <Toast message={message?.text ?? null} persist={message?.error} onDone={clearMessage} />

      {panel !== 'none' && (
        <div className="flex flex-col gap-3 rounded-3xl bg-white p-5 ring-1 ring-line">
          <div className="-mt-2 -mr-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {panel === 'reschedule' ? 'Change date or transport' : 'Plan this date again on'}
            </p>
            <button
              type="button"
              onClick={() => setPanel('none')}
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-cream"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="m3 3 6 6M9 3 3 9" />
              </svg>
            </button>
          </div>
          <WindowFields value={window} onChange={setWindow} />
          {panel === 'reschedule' && (
            <div className="flex gap-2" role="group" aria-label="Transport">
              {TRANSPORTS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={transport === t.value}
                  onClick={() => setTransport(t.value)}
                  className={`min-h-11 flex-auto rounded-full px-3 text-sm font-medium whitespace-nowrap ${
                    transport === t.value
                      ? 'bg-butter text-ink'
                      : 'bg-cream text-ink hover:bg-butter/60'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={pending}
            className="rounded-full bg-ink px-5 py-3.5 text-white disabled:opacity-50 hover:bg-ink/85"
            onClick={() =>
              panel === 'reschedule'
                ? edit({ type: 'reschedule', window, transport })
                : run(async () => {
                    const result = await planAgainAction(plan.id, window);
                    if (!result.ok) return fail(result.error);
                    router.push(`/plans/${result.data}`);
                  })
            }
          >
            {pending ? 'Planning…' : panel === 'reschedule' ? 'Update plan' : 'Create plan'}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {editable && (
          <button
            type="button"
            className={rowButton}
            aria-expanded={panel === 'reschedule'}
            onClick={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')}
          >
            Change plan
          </button>
        )}
        <button
          type="button"
          className={rowButton}
          aria-expanded={panel === 'again'}
          onClick={() => setPanel(panel === 'again' ? 'none' : 'again')}
        >
          Plan again
        </button>
        <button
          type="button"
          disabled={pending}
          className="min-h-11 flex-auto rounded-xl bg-red-600 px-4 py-2 text-sm whitespace-nowrap text-white hover:bg-red-700 disabled:opacity-50"
          onClick={() => {
            if (!confirm('Delete this plan?')) return;
            run(async () => {
              const result = await deletePlanAction(plan.id);
              if (!result.ok) return fail(result.error);
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
