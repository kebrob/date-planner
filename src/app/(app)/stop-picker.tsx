'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration } from '@/lib/duration';
import type { IdeaOption } from '@/planner/chosen';
import type { ChosenStopInput } from '@/planner/service';
import type { LatLng, Place } from '@/ports/places';
import { addIdeaAction, listIdeaOptionsAction, searchPlacesAction } from './actions';
import { useFocusTrap } from './focus-trap';
import { SearchField } from './search-field';

export type PickedStop = {
  stop: ChosenStopInput;
  title: string;
  /** Shown in lists, e.g. "Any time" or "at 18:00". */
  when: string | null;
};

type Kind = 'activity' | 'meal' | 'snack';
type Mode = 'keep' | 'around';

type Props = {
  heading: string;
  /** Centre for place searches; home when null. */
  near: LatLng | null;
  /** Offer a fixed start time within this window ("HH:MM"). */
  timeWindow?: { start: string; end: string };
  /** Replacing a stop: ask whether the other stops stay. */
  askMode?: boolean;
  /** Offers to let the planner pick instead (adding a stop to a gap). */
  onSurprise?: () => void;
  onPick: (picked: PickedStop, mode: Mode) => void;
  onClose: () => void;
};

const KINDS: { value: Kind; label: string }[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'meal', label: 'Meal' },
  { value: 'snack', label: 'Coffee or snack' },
];
const DURATIONS = [60, 90, 120, 180];

const input = 'min-h-12 w-full rounded-2xl bg-white px-4 text-[16px] ring-1 ring-line';
const row =
  'flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-line hover:bg-cream';
const chip = (selected: boolean) =>
  `min-h-11 rounded-full px-4 text-sm font-medium ${selected ? 'bg-ink text-white' : 'bg-cream text-ink hover:bg-butter'}`;
const primary =
  'min-h-12 w-full rounded-full bg-ink px-5 text-[15px] font-medium text-white hover:bg-ink/85 disabled:opacity-50';

const cost = (min: number, max: number) => (max === 0 ? 'free' : `${min}–${max} €`);
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Bottom sheet to pick one of your ideas, or – on request – a place found on Google. */
export function StopPicker({
  heading,
  near,
  timeWindow,
  askMode,
  onSurprise,
  onPick,
  onClose,
}: Props) {
  const [ideas, setIdeas] = useState<IdeaOption[] | null>(null);
  const [query, setQuery] = useState('');
  // What the place search ran with; the field may change while it runs.
  const [searched, setSearched] = useState('');
  const [stage, setStage] = useState<'search' | 'places' | 'details' | 'confirm'>('search');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [details, setDetails] = useState({
    title: '',
    kind: 'activity' as Kind,
    durationMinutes: 90,
    costEur: 0,
    save: false,
  });
  const [picked, setPicked] = useState<{ stop: ChosenStopInput; title: string } | null>(null);
  const [fixedTime, setFixedTime] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchField = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Loaded on every open, so ideas changed meanwhile (e.g. in admin) show up.
    void listIdeaOptionsAction()
      .then((r) => (r.ok ? setIdeas(r.data) : setMessage(r.error)))
      .catch(() => setMessage('Connection problem. Please try again.'));
    searchField.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (ideas ?? []).filter((idea) =>
      words.every((w) => `${idea.title.toLowerCase()} ${idea.keywords}`.includes(w)),
    );
  }, [ideas, query]);

  const choose = (stop: ChosenStopInput, title: string) => {
    setPicked({ stop, title });
    if (timeWindow || askMode) setStage('confirm');
    else onPick({ stop, title, when: null }, 'keep');
  };

  const searchGoogle = async () => {
    const text = query.trim();
    if (searching) return;
    setSearching(true);
    setMessage(null);
    try {
      const result = await searchPlacesAction({ query: text, near });
      if (!result.ok) return setMessage(result.error);
      setSearched(text);
      setPlaces(result.data.places);
      setStage('places');
      if (result.data.places.length === 0) {
        setMessage(
          result.data.limitReached
            ? "Today's place searches are used up. Pick one of your ideas or try tomorrow."
            : `Nothing found for “${text}” nearby. Try other words.`,
        );
      }
    } catch {
      setMessage('Connection problem. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const pickPlace = (p: Place) => {
    setPlace(p);
    const perPerson = p.pricePerPerson;
    setDetails({
      title: capitalized(searched),
      kind: perPerson ? 'meal' : 'activity',
      durationMinutes: perPerson ? 90 : 120,
      costEur: perPerson
        ? Math.round(((perPerson.min + (perPerson.max ?? perPerson.min)) / 2) * 2)
        : 0,
      save: false,
    });
    setStage('details');
  };

  const confirmDetails = async () => {
    const custom = { ...details, title: details.title.trim(), query: searched };
    if (!details.save) {
      return choose(
        { activityId: null, custom, place, startTime: null, index: null },
        custom.title,
      );
    }
    setSaving(true);
    const result = await addIdeaAction(custom)
      .catch(() => ({ ok: false as const, error: 'Connection problem. Please try again.' }))
      .finally(() => setSaving(false));
    if (!result.ok) return setMessage(result.error);
    choose(
      { activityId: result.data, custom: null, place, startTime: null, index: null },
      custom.title,
    );
  };

  const finish = (mode: Mode) => {
    if (!picked) return;
    onPick(
      {
        stop: { ...picked.stop, startTime: fixedTime },
        title: picked.title,
        when: fixedTime ? `at ${fixedTime}` : timeWindow ? 'Any time' : null,
      },
      mode,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        className="relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-paper pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 place-items-center rounded-full bg-cream hover:bg-butter"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="m3 3 8 8M11 3 3 11" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 pt-1 pb-2">
          {stage === 'search' && (
            <>
              {onSurprise && (
                <button
                  type="button"
                  onClick={onSurprise}
                  className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-butter px-4 py-3 text-left hover:bg-butter-deep"
                >
                  <span className="font-medium">Surprise us</span>
                  <span className="text-sm text-ink/70">
                    Let the planner pick something for this time
                  </span>
                </button>
              )}
              {/* Stays in view while the list scrolls; the padding keeps the focus ring visible. */}
              <div className="sticky top-0 z-10 -mx-5 -mt-1 bg-paper px-5 pt-1 pb-2">
                <SearchField
                  inputRef={searchField}
                  value={query}
                  onChange={setQuery}
                  maxLength={80}
                  placeholder="e.g. ice skating, sushi, bowling"
                  ariaLabel="Search your ideas"
                />
              </div>
              {ideas === null && !message && (
                <p className="text-sm text-mist">Loading your ideas…</p>
              )}
              <ul className="flex flex-col gap-2">
                {matches.map((idea) => (
                  <li key={idea.id}>
                    <button
                      type="button"
                      className={row}
                      onClick={() =>
                        choose(
                          {
                            activityId: idea.id,
                            custom: null,
                            place: null,
                            startTime: null,
                            index: null,
                          },
                          idea.title,
                        )
                      }
                    >
                      <span className="font-medium">{idea.title}</span>
                      <span className="shrink-0 text-sm text-mist">
                        {formatDuration(idea.durationMinutes)} ·{' '}
                        {cost(idea.costMinEur, idea.costMaxEur)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {ideas !== null && query.trim().length >= 2 && (
                <div className="flex flex-col gap-2 rounded-2xl bg-cream p-4">
                  <p className="text-sm">
                    {matches.length === 0
                      ? `None of your ideas match “${query.trim()}”.`
                      : 'Not what you had in mind?'}
                  </p>
                  <button
                    type="button"
                    className={primary}
                    disabled={searching}
                    onClick={searchGoogle}
                  >
                    {searching ? 'Searching…' : `Search Google for “${query.trim()}”`}
                  </button>
                  <p className="text-xs text-mist">Uses one of today&apos;s place searches.</p>
                </div>
              )}
            </>
          )}

          {stage === 'places' && (
            <>
              <button
                type="button"
                className="min-h-11 self-start text-sm text-mist hover:text-ink"
                onClick={() => setStage('search')}
              >
                ← Back to your ideas
              </button>
              <ul className="flex flex-col gap-2">
                {(places ?? []).map((p) => (
                  <li key={p.id}>
                    <button type="button" className={row} onClick={() => pickPlace(p)}>
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{p.name}</span>
                        {p.address && (
                          <span className="truncate text-sm text-mist">{p.address}</span>
                        )}
                      </span>
                      {p.rating && <span className="shrink-0 text-sm text-mist">★ {p.rating}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {stage === 'details' && place && (
            <>
              <p className="text-sm text-mist">{place.name}</p>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Name in your plan
                <input
                  className={input}
                  value={details.title}
                  onChange={(e) => setDetails({ ...details, title: e.target.value })}
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">What is it?</span>
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      aria-pressed={details.kind === k.value}
                      className={chip(details.kind === k.value)}
                      onClick={() => setDetails({ ...details, kind: k.value })}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">How long?</span>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={details.durationMinutes === d}
                      className={chip(details.durationMinutes === d)}
                      onClick={() => setDetails({ ...details, durationMinutes: d })}
                    >
                      {formatDuration(d)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Cost for both (€)
                <input
                  className={input}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000}
                  value={details.costEur}
                  onChange={(e) =>
                    setDetails({
                      ...details,
                      costEur: Math.max(0, Math.min(1000, Number(e.target.value) || 0)),
                    })
                  }
                />
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={details.save}
                onClick={() => setDetails({ ...details, save: !details.save })}
                className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 text-left ${
                  details.save ? 'bg-butter' : 'bg-white ring-1 ring-line'
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">Add to our ideas</span>
                  <span className="text-sm text-mist">
                    Find it without Google next time, may be suggested
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${details.save ? 'bg-ink' : 'bg-line'}`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${details.save ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </span>
              </button>
              <button
                type="button"
                className={primary}
                disabled={saving || details.title.trim().length < 2}
                onClick={confirmDetails}
              >
                {saving ? 'Saving…' : 'Use this'}
              </button>
            </>
          )}

          {stage === 'confirm' && picked && (
            <>
              <p className="text-[17px] font-medium">{picked.title}</p>
              {timeWindow && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">When?</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={fixedTime === null}
                      className={chip(fixedTime === null)}
                      onClick={() => setFixedTime(null)}
                    >
                      Any time
                    </button>
                    <button
                      type="button"
                      aria-pressed={fixedTime !== null}
                      className={chip(fixedTime !== null)}
                      onClick={() => setFixedTime(fixedTime ?? timeWindow.start)}
                    >
                      At a set time
                    </button>
                    {fixedTime !== null && (
                      <input
                        type="time"
                        className="min-h-11 rounded-full bg-white px-4 text-[16px] ring-1 ring-line"
                        value={fixedTime}
                        onChange={(e) => setFixedTime(e.target.value || timeWindow.start)}
                        aria-label="Start time"
                      />
                    )}
                  </div>
                </div>
              )}
              {askMode ? (
                <div className="flex flex-col gap-2">
                  <button type="button" className={row} onClick={() => finish('keep')}>
                    <span className="flex flex-col">
                      <span className="font-medium">Keep the rest</span>
                      <span className="text-sm text-mist">Other stops stay, only times move</span>
                    </span>
                  </button>
                  <button type="button" className={row} onClick={() => finish('around')}>
                    <span className="flex flex-col">
                      <span className="font-medium">Re-plan around it</span>
                      <span className="text-sm text-mist">New suggestions for everything else</span>
                    </span>
                  </button>
                </div>
              ) : (
                <button type="button" className={primary} onClick={() => finish('keep')}>
                  Add
                </button>
              )}
            </>
          )}

          {message && <p className="text-sm text-red-600">{message}</p>}
        </div>
      </div>
    </div>
  );
}
