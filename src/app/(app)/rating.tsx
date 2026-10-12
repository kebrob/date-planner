'use client';

import { shortDayFormat } from '@/lib/time';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SavedPlanView } from '@/planner/saved';
import type { RatingPrompt as Prompt } from '@/ratings/service';
import { setActivityStatusAction } from './admin/actions';
import {
  dismissRatingPromptAction,
  rateDateAction,
  rateItemAction,
  setNotHappenedAction,
} from './actions';
import { RATING_OPTIONS } from './rating-options';

type Rating = SavedPlanView['rating'];

// At least 44 px high: these are tapped on the phone, often on the way home.
const quietButton =
  'inline-flex min-h-11 items-center rounded-full px-3 text-sm text-mist hover:bg-white/70 hover:text-ink disabled:opacity-50';

/** Three options; tapping the selected one again removes the rating. */
export function RatingButtons({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: Rating;
  onChange: (rating: Rating) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Rating">
      {RATING_OPTIONS.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : o.value)}
            className={`flex items-center justify-center rounded-2xl active:scale-95 disabled:opacity-70 ${
              compact
                ? 'min-h-14 flex-col gap-0.5 px-1 text-xs'
                : 'min-h-[76px] flex-col gap-1 px-2 text-sm font-medium'
            } ${selected ? 'bg-ink text-white' : 'bg-white text-ink ring-1 ring-line hover:bg-butter'}`}
          >
            <span aria-hidden className={compact ? 'text-lg' : 'text-[26px] leading-none'}>
              {o.emoji}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Rating of a whole past date, with "We didn't go" and the option to rate single stops. */
export function DateRating({
  plan,
  showItems,
  onShowItems,
}: {
  plan: SavedPlanView;
  showItems: boolean;
  onShowItems: (show: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState<Rating>(plan.rating);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      router.refresh();
    });

  if (plan.notHappened) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-3xl bg-cream p-4 text-sm">
        <span>Marked as not happened – not used for suggestions.</span>
        <button
          type="button"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-full bg-white px-4 font-medium ring-1 ring-line hover:bg-butter disabled:opacity-50"
          onClick={() => run(() => setNotHappenedAction(plan.id, false))}
        >
          Undo
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-white p-5 ring-1 ring-line">
      <p className="font-medium">How was it?</p>
      <RatingButtons
        value={rating}
        disabled={pending}
        onChange={(next) => {
          const previous = rating;
          setRating(next);
          run(async () => {
            const result = await rateDateAction(plan.id, next);
            if (!result.ok) setRating(previous);
            return result;
          });
        }}
      />
      <div className="-mx-3 flex flex-wrap justify-between">
        <button
          type="button"
          className={quietButton}
          onClick={() => onShowItems(!showItems)}
          aria-expanded={showItems}
        >
          {showItems ? 'Hide single stops' : 'Rate single stops'}
        </button>
        <button
          type="button"
          disabled={pending}
          className={quietButton}
          onClick={() => run(() => setNotHappenedAction(plan.id, true))}
        >
          We didn&apos;t go
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

/** Rating of one stop; a 👎 for a stop with a venue can blame the venue instead of the idea. */
export function ItemRating({
  planId,
  position,
  activityId,
  hasPlace,
  initial,
}: {
  planId: string;
  position: number;
  activityId: string;
  hasPlace: boolean;
  initial: SavedPlanView['itemRatings'][number];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState<Rating>(initial.rating);
  const [placeBlamed, setPlaceBlamed] = useState(initial.placeBlamed);
  const [suggestBlock, setSuggestBlock] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = (next: Rating, blamed: boolean) => {
    const previous = { rating, placeBlamed };
    // Outside the transition, so the buttons and checkbox respond before the server does.
    setRating(next);
    setPlaceBlamed(blamed);
    setError(null);
    startTransition(async () => {
      const result = await rateItemAction(planId, position, next, blamed);
      if (!result.ok) {
        setRating(previous.rating);
        setPlaceBlamed(previous.placeBlamed);
        setError(result.error);
        return;
      }
      setSuggestBlock(result.data.suggestBlock);
      router.refresh();
    });
  };

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
      <RatingButtons
        compact
        value={rating}
        disabled={pending}
        onChange={(next) => save(next, next === 'dislike' && placeBlamed)}
      />
      {rating === 'dislike' && hasPlace && (
        <button
          type="button"
          role="switch"
          aria-checked={placeBlamed}
          disabled={pending}
          onClick={() => save('dislike', !placeBlamed)}
          className={`flex min-h-11 items-center gap-3 rounded-2xl px-3 text-left text-sm disabled:opacity-70 ${
            placeBlamed ? 'bg-butter text-ink' : 'bg-paper text-mist ring-1 ring-line'
          }`}
        >
          <span
            aria-hidden
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
              placeBlamed ? 'bg-ink text-white' : 'bg-white ring-1 ring-line'
            }`}
          >
            {placeBlamed && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m2.5 6.5 2.5 2.5 4.5-6" />
              </svg>
            )}
          </span>
          It was the place, not the idea
        </button>
      )}
      {suggestBlock && !blocked && !activityId.startsWith('builtin-') && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-mist">
          Not your thing twice now. Stop suggesting it?
          <button
            type="button"
            disabled={pending}
            className="min-h-11 rounded-full bg-cream px-4 text-ink hover:bg-butter disabled:opacity-50"
            onClick={() =>
              startTransition(async () => {
                const result = await setActivityStatusAction(activityId, 'blocked');
                setBlocked(result.ok);
              })
            }
          >
            Block idea
          </button>
        </p>
      )}
      {blocked && <p className="text-sm text-mist">Blocked – it won&apos;t be suggested again.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Home screen nudge for a recent, unrated date. */
export function RatingPromptCard({ prompt }: { prompt: Prompt }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) return setError(result.error ?? 'Something went wrong.');
      setDone(true);
      router.refresh();
    });

  if (done) return null;
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-cream p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">How was {shortDayFormat.format(prompt.startsAt)}?</p>
          <p className="text-sm text-mist">{prompt.titles.join(' → ')}</p>
        </div>
        <button
          type="button"
          disabled={pending}
          className={`${quietButton} -mt-2 -mr-3`}
          onClick={() => run(() => dismissRatingPromptAction(prompt.id))}
        >
          Skip
        </button>
      </div>
      <RatingButtons
        value={null}
        disabled={pending}
        onChange={(rating) => rating && run(() => rateDateAction(prompt.id, rating))}
      />
      <button
        type="button"
        disabled={pending}
        className={`${quietButton} -mx-3 self-start`}
        onClick={() => run(() => setNotHappenedAction(prompt.id, true))}
      >
        We didn&apos;t go
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
