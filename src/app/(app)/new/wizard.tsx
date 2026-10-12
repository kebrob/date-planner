'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { autoAreaRadiusKm, autoRadiusKm } from '@/core/planner/build-plan';
import { fromLocal, minutesBetween } from '@/lib/time';
import type { PlanInput } from '@/planner/service';
import { LocationPicker, type Point } from '../location-picker';
import { SessionResult, usePlanSession } from '../plan-session';
import { StopPicker, type PickedStop } from '../stop-picker';
import { MOODS } from '../moods';
import { Face } from './face';
import { outingPreset, presets } from './presets';

type Transport = PlanInput['transport'];
type Food = NonNullable<PlanInput['food']>;
type Cuisine = NonNullable<PlanInput['cuisine']>;
type Format = NonNullable<PlanInput['format']>;

export type WizardDefaults = {
  transport: Transport;
  budgetEur: number;
  homeName: string;
  home: { lat: number; lng: number };
  maxRadiusKm: number;
};

const STEPS = ['when', 'where', 'plans', 'how', 'mood', 'food'] as const;
type Step = (typeof STEPS)[number];

const TRANSPORTS: { value: Transport; label: string; hint: string }[] = [
  {
    value: 'deutschlandticket',
    label: 'Deutschlandticket',
    hint: 'Public transport, regional trains',
  },
  { value: 'car', label: 'Car', hint: 'Drive between stops' },
  { value: 'walk', label: 'On foot', hint: 'Everything within ~4 km' },
];

const FOODS: { value: Food; label: string; hint: string }[] = [
  { value: 'auto', label: 'Surprise us', hint: 'Maybe a meal, maybe a snack' },
  { value: 'meal', label: 'A proper meal', hint: 'Dinner, lunch or brunch' },
  { value: 'snack', label: 'Coffee or ice cream', hint: 'Something small' },
  { value: 'none', label: 'No food', hint: 'Just the plan' },
];

const CUISINES: { value: Cuisine | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 'bavarian', label: 'Bavarian' },
  { value: 'italian', label: 'Italian' },
  { value: 'asian', label: 'Asian' },
  { value: 'burger', label: 'Burger' },
  { value: 'mexican', label: 'Mexican' },
  { value: 'greek', label: 'Greek' },
  { value: 'indian', label: 'Indian' },
  { value: 'veggie', label: 'Veggie' },
];

const FORMATS: { value: Format | null; label: string }[] = [
  { value: null, label: 'Fits the time' },
  { value: 'single', label: 'One thing' },
  { value: 'evening', label: 'Two stops' },
  { value: 'day', label: 'Full day' },
];

function Choice({
  selected,
  onClick,
  children,
  className = '',
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-3 text-sm font-medium ${
        selected ? 'bg-butter text-ink' : 'bg-cream text-ink hover:bg-butter/60'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Whether the date starts/ends at home or already in the chosen place (no train there/back). */
function TripEnds(props: {
  place: string | null;
  startInArea: boolean;
  onStartChange: (v: boolean) => void;
  endInArea: boolean;
  onEndChange: (v: boolean) => void;
}) {
  const there = props.place ? `in ${props.place}` : 'there';
  const rows = [
    {
      label: 'Starting',
      value: props.startInArea,
      onChange: props.onStartChange,
      options: ['From home', `Already ${there}`],
    },
    {
      label: 'Afterwards',
      value: props.endInArea,
      onChange: props.onEndChange,
      options: ['Back home', `Staying ${there}`],
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1.5">
          <span className="text-xs text-mist">{row.label}</span>
          <div className="grid grid-cols-2 gap-2">
            {row.options.map((option, i) => (
              <Choice
                key={option}
                selected={row.value === (i === 1)}
                onClick={() => row.onChange(i === 1)}
                className="truncate"
              >
                {option}
              </Choice>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OptionRow({
  selected,
  onClick,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between rounded-3xl px-5 py-4 text-left ${
        selected ? 'bg-butter' : 'bg-white ring-1 ring-line hover:bg-cream'
      }`}
    >
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-mist">{hint}</span>
      </span>
      <span
        className={`grid h-6 w-6 place-items-center rounded-full border ${
          selected ? 'border-ink bg-ink text-white' : 'border-line'
        }`}
        aria-hidden
      >
        {selected && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m2.5 6.2 2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

const field = 'w-full rounded-2xl bg-white px-4 py-3 text-[15px] ring-1 ring-line';

export function Wizard({
  defaults,
  quick,
  idea,
}: {
  defaults: WizardDefaults;
  quick: boolean;
  idea: { id: string; title: string } | null;
}) {
  const session = usePlanSession();
  const [step, setStep] = useState<Step | 'result'>(quick ? 'result' : 'when');
  const [when, setWhen] = useState(() => outingPreset());
  const [center, setCenter] = useState<Point | null>(null);
  const [startInArea, setStartInArea] = useState(false);
  const [endInArea, setEndInArea] = useState(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | null>(null);
  const [transport, setTransport] = useState<Transport>(defaults.transport);
  const [budgetEur, setBudgetEur] = useState(defaults.budgetEur);
  const [format, setFormat] = useState<Format | null>(null);
  const [moods, setMoods] = useState<string[]>([]);
  const [food, setFood] = useState<Food>('auto');
  const [cuisine, setCuisine] = useState<Cuisine | null>(null);
  const [picks, setPicks] = useState<PickedStop[]>([]);
  const [picking, setPicking] = useState(false);

  const windowMinutes = (() => {
    try {
      return minutesBetween(
        fromLocal(when.date, when.startTime),
        fromLocal(when.endDate, when.endTime),
      );
    } catch {
      return 0;
    }
  })();
  const autoKm = center
    ? autoAreaRadiusKm(transport)
    : autoRadiusKm(transport, windowMinutes, defaults.maxRadiusKm);

  const input = (): PlanInput => ({
    date: when.date,
    startTime: when.startTime,
    endDate: when.endDate,
    endTime: when.endTime,
    budgetEur,
    transport,
    preferences: moods,
    format: format ?? undefined,
    food,
    cuisine: food === 'meal' || food === 'auto' ? cuisine : null,
    areaPoint: center ?? undefined,
    startInArea: center ? startInArea : undefined,
    endInArea: center ? endInArea : undefined,
    maxDistanceKm,
    requiredActivityIds: idea ? [idea.id] : undefined,
    chosen: picks.length > 0 ? picks.map((p) => p.stop) : undefined,
    excludeActivityIds: [],
  });

  // "Surprise us" and idea shortcuts plan immediately with the defaults.
  const started = useRef(false);
  useEffect(() => {
    if (quick && !started.current) {
      started.current = true;
      session.start(input());
    }
    // Run once on mount for quick plans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const index = step === 'result' ? STEPS.length : STEPS.indexOf(step);
  // Every step starts at the top, like a new screen.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  const next = () => {
    if (index >= STEPS.length - 1) {
      setStep('result');
      session.start(input());
    } else {
      setStep(STEPS[index + 1]!);
    }
  };
  const back = () => setStep(index === 0 ? 'when' : (STEPS[index - 1] ?? 'when'));
  const skip = () => {
    if (step === 'where') {
      setCenter(null);
      setMaxDistanceKm(null);
    }
    if (step === 'plans') setPicks([]);
    if (step === 'how') setFormat(null);
    if (step === 'mood') setMoods([]);
    if (step === 'food') {
      setFood('auto');
      setCuisine(null);
    }
    next();
  };

  const activeMood = MOODS.find((m) => m.tag === moods.at(-1));

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <div className="flex items-center gap-3">
        {index === 0 || step === 'result' ? (
          <Link
            href="/"
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-cream"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="m4 4 10 10M14 4 4 14" />
            </svg>
          </Link>
        ) : (
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-cream"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 3 5 9l6 6" />
            </svg>
          </button>
        )}
        <div
          className="flex flex-1 gap-1.5"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={index}
        >
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1 flex-1 rounded-full ${i < index || step === 'result' ? 'bg-ink' : i === index ? 'bg-ink/40' : 'bg-line'}`}
            />
          ))}
        </div>
      </div>

      {step === 'result' ? (
        <div className="mt-6 flex flex-col gap-5">
          <div className="flex items-end justify-between">
            <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
              {session.planning ? 'Planning your date…' : 'Your date'}
            </h1>
            {!quick && (
              <button
                type="button"
                onClick={() => setStep('when')}
                className="text-sm text-mist underline hover:text-ink"
              >
                Change answers
              </button>
            )}
          </div>
          {idea && <p className="text-sm text-mist">Including {idea.title.toLowerCase()}.</p>}
          {session.message && <p className="text-sm text-red-600">{session.message}</p>}
          <SessionResult session={session} />
          {quick && session.current && (
            <Link href="/new" className="text-center text-sm text-mist underline hover:text-ink">
              Plan it step by step instead
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-1 flex-col gap-6">
            {step === 'when' && (
              <>
                <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                  When&apos;s your date?
                </h1>
                <div className="grid grid-cols-2 gap-2.5">
                  {presets().map((p) => (
                    <Choice
                      key={p.label}
                      selected={
                        p.date === when.date &&
                        p.startTime === when.startTime &&
                        p.endTime === when.endTime
                      }
                      onClick={() => setWhen(p)}
                    >
                      {p.label}
                    </Choice>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {/* One caption for two inputs, so each input carries its own name. */}
                  <div role="group" aria-label="From" className="flex flex-col gap-1.5 text-mist">
                    <span aria-hidden>From</span>
                    <input
                      type="date"
                      aria-label="Start date"
                      className={field}
                      value={when.date}
                      onChange={(e) => setWhen({ ...when, date: e.target.value })}
                    />
                    <input
                      type="time"
                      aria-label="Start time"
                      className={field}
                      value={when.startTime}
                      onChange={(e) => setWhen({ ...when, startTime: e.target.value })}
                    />
                  </div>
                  <div role="group" aria-label="Until" className="flex flex-col gap-1.5 text-mist">
                    <span aria-hidden>Until</span>
                    <input
                      type="date"
                      aria-label="End date"
                      className={field}
                      value={when.endDate}
                      onChange={(e) => setWhen({ ...when, endDate: e.target.value })}
                    />
                    <input
                      type="time"
                      aria-label="End time"
                      className={field}
                      value={when.endTime}
                      onChange={(e) => setWhen({ ...when, endTime: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 'where' && (
              <>
                <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                  Where should it be?
                </h1>
                <p className="-mt-3 text-sm text-mist">
                  Around {defaults.homeName} unless you pick a town or tap the map. “Fit to time”
                  keeps the trip there to about a quarter of your time.
                </p>
                <LocationPicker
                  home={{ name: defaults.homeName, ...defaults.home }}
                  center={center}
                  onCenterChange={setCenter}
                  radiusKm={maxDistanceKm}
                  onRadiusChange={setMaxDistanceKm}
                  autoRadiusKm={autoKm}
                />
                {center && (
                  <TripEnds
                    place={center.name === 'Pinned location' ? null : center.name.split(',')[0]!}
                    startInArea={startInArea}
                    onStartChange={setStartInArea}
                    endInArea={endInArea}
                    onEndChange={setEndInArea}
                  />
                )}
              </>
            )}

            {step === 'plans' && (
              <>
                <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                  Anything set already?
                </h1>
                <p className="-mt-3 text-sm text-mist">
                  Add what you want to do for sure, at a set time if you like. The planner fits the
                  rest around it.
                </p>
                {picks.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {picks.map((p, i) => (
                      <li
                        key={`${p.title}-${i}`}
                        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-butter px-4 py-2"
                      >
                        <span className="flex flex-col">
                          <span className="font-medium">{p.title}</span>
                          {p.when && <span className="text-sm text-ink/70">{p.when}</span>}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${p.title}`}
                          onClick={() => setPicks((cur) => cur.filter((_, j) => j !== i))}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/70 hover:bg-white"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            aria-hidden
                          >
                            <path d="m3 3 6 6M9 3 3 9" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {picks.length < 3 && (
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-[15px] font-medium hover:bg-cream"
                  >
                    <span aria-hidden className="text-xl leading-none">
                      +
                    </span>
                    {picks.length === 0 ? 'Add something' : 'Add another'}
                  </button>
                )}
                {picking && (
                  <StopPicker
                    heading="What do you want to do?"
                    near={center}
                    timeWindow={{ start: when.startTime, end: when.endTime }}
                    onClose={() => setPicking(false)}
                    onPick={(picked) => {
                      setPicks((cur) => [...cur, picked]);
                      setPicking(false);
                    }}
                  />
                )}
              </>
            )}

            {step === 'how' && (
              <>
                <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                  How do you get around?
                </h1>
                <div className="flex flex-col gap-2.5">
                  {TRANSPORTS.map((t) => (
                    <OptionRow
                      key={t.value}
                      selected={transport === t.value}
                      onClick={() => setTransport(t.value)}
                      label={t.label}
                      hint={t.hint}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">Budget for both</span>
                    <span className="text-2xl font-semibold tabular-nums">{budgetEur} €</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={300}
                    step={5}
                    value={budgetEur}
                    onChange={(e) => setBudgetEur(Number(e.target.value))}
                    className="accent-ink"
                    aria-label="Budget in euros"
                  />
                  <span className="text-xs text-mist">
                    May go up to 50 % over if the day would otherwise end early.
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="font-medium">How much should happen?</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {FORMATS.map((f) => (
                      <Choice
                        key={f.label}
                        selected={format === f.value}
                        onClick={() => setFormat(f.value)}
                      >
                        {f.label}
                      </Choice>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 'mood' && (
              <>
                <h1 className="text-[30px] leading-tight font-semibold tracking-tight">
                  How are you feeling?
                </h1>
                <div
                  className={`mx-auto flex w-60 -rotate-2 flex-col items-center gap-1 rounded-[36px] p-7 transition-colors ${activeMood?.tint ?? 'bg-butter'}`}
                >
                  <Face variant={activeMood?.face ?? 'happy'} />
                  <span className="text-lg font-medium">
                    {activeMood?.label.toLowerCase() ?? 'anything goes'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {MOODS.map((m) => (
                    <Choice
                      key={m.tag}
                      selected={moods.includes(m.tag)}
                      onClick={() =>
                        setMoods((cur) =>
                          cur.includes(m.tag) ? cur.filter((x) => x !== m.tag) : [...cur, m.tag],
                        )
                      }
                      className="px-2"
                    >
                      {m.label}
                    </Choice>
                  ))}
                </div>
              </>
            )}

            {step === 'food' && (
              <>
                <h1 className="text-[30px] leading-tight font-semibold tracking-tight">Hungry?</h1>
                <div className="flex flex-col gap-2.5">
                  {FOODS.map((f) => (
                    <OptionRow
                      key={f.value}
                      selected={food === f.value}
                      onClick={() => setFood(f.value)}
                      label={f.label}
                      hint={f.hint}
                    />
                  ))}
                </div>
                {(food === 'meal' || food === 'auto') && (
                  <div className="flex flex-col gap-2">
                    <span className="font-medium">Any cuisine in mind?</span>
                    <div className="grid grid-cols-3 gap-2.5">
                      {CUISINES.map((c) => (
                        <Choice
                          key={c.label}
                          selected={cuisine === c.value}
                          onClick={() => setCuisine(c.value)}
                          className="px-2"
                        >
                          {c.label}
                        </Choice>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="sticky bottom-0 mt-8 flex flex-col gap-2.5 bg-paper pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={skip}
              className="rounded-full border border-line bg-white py-3.5 text-sm font-medium hover:bg-cream"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={next}
              className="rounded-full bg-ink py-3.5 text-sm font-medium text-white hover:bg-ink/85"
            >
              {index === STEPS.length - 1 ? 'Show our date' : 'Continue'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
