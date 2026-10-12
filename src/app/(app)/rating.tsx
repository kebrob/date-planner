'use client';

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

const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

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
    <div className="flex gap-2" role="group" aria-label="Rating">
      {RATING_OPTIONS.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : o.value)}
            className={`flex items-center gap-1.5 rounded-full disabled:opacity-50 ${
              compact ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'
            } ${selected ? 'bg-ink text-white' : 'bg-cream text-ink hover:bg-butter'}`}
          >
            <span aria-hidden>{o.emoji}</span>
            {compact ? <span className="sr-only">{o.label}</span> : o.label}
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
      <section className="flex items-center justify-between rounded-3xl bg-cream p-4 text-sm">
        <span>Marked as not happened – not used for suggestions.</span>
        <button
          type="button"
          disabled={pending}
          className="underline disabled:opacity-50"
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
          setRating(next);
          run(() => rateDateAction(plan.id, next));
        }}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-mist">
        <button
          type="button"
          className="hover:text-ink"
          onClick={() => onShowItems(!showItems)}
          aria-expanded={showItems}
        >
          {showItems ? 'Hide single stops' : 'Rate single stops'}
        </button>
        <button
          type="button"
          disabled={pending}
          className="hover:text-ink disabled:opacity-50"
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

  const save = (next: Rating, blamed: boolean) =>
    startTransition(async () => {
      setRating(next);
      setPlaceBlamed(blamed);
      const result = await rateItemAction(planId, position, next, blamed);
      setSuggestBlock(result.ok && result.data.suggestBlock);
      router.refresh();
    });

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
      <RatingButtons
        compact
        value={rating}
        disabled={pending}
        onChange={(next) => save(next, next === 'dislike' && placeBlamed)}
      />
      {rating === 'dislike' && hasPlace && (
        <label className="flex items-center gap-2 text-xs text-mist">
          <input
            type="checkbox"
            checked={placeBlamed}
            disabled={pending}
            onChange={(e) => save('dislike', e.target.checked)}
          />
          It was the place, not the idea
        </label>
      )}
      {suggestBlock && !blocked && !activityId.startsWith('builtin-') && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-mist">
          Not your thing twice now. Stop suggesting it?
          <button
            type="button"
            disabled={pending}
            className="rounded-full bg-cream px-3 py-1 text-ink hover:bg-butter disabled:opacity-50"
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
      {blocked && <p className="text-xs text-mist">Blocked – it won&apos;t be suggested again.</p>}
    </div>
  );
}

/** Home screen nudge for a recent, unrated date. */
export function RatingPromptCard({ prompt }: { prompt: Prompt }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      await action();
      setDone(true);
      router.refresh();
    });

  if (done) return null;
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-cream p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">How was {DAY.format(prompt.startsAt)}?</p>
          <p className="text-sm text-mist">{prompt.titles.join(' → ')}</p>
        </div>
        <button
          type="button"
          disabled={pending}
          className="text-sm text-mist hover:text-ink disabled:opacity-50"
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
        className="self-start text-sm text-mist hover:text-ink disabled:opacity-50"
        onClick={() => run(() => setNotHappenedAction(prompt.id, true))}
      >
        We didn&apos;t go
      </button>
    </section>
  );
}
