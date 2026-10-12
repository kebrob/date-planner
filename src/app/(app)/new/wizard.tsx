'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { autoAreaRadiusKm, autoRadiusKm } from '@/core/planner/build-plan';
import { fromLocal, minutesBetween } from '@/lib/time';
import type { PlanInput } from '@/planner/service';
import { BackIcon } from '../icons';
import type { Point } from '../location-picker';
import { SessionResult, usePlanSession } from '../plan-session';
import type { PickedStop } from '../stop-picker';
import { StepHeading } from './controls';
import type { TimePreset } from './presets';
import { FoodStep, HowStep, MoodStep, PlansStep, WhenStep, WhereStep, type Format } from './steps';

type Transport = PlanInput['transport'];
type Food = NonNullable<PlanInput['food']>;
type Cuisine = NonNullable<PlanInput['cuisine']>;

type WizardDefaults = {
  transport: Transport;
  budgetEur: number;
  homeName: string;
  home: { lat: number; lng: number };
  maxRadiusKm: number;
};

const STEPS = ['when', 'where', 'plans', 'how', 'mood', 'food'] as const;
type Step = (typeof STEPS)[number];

export function Wizard({
  defaults,
  quick,
  idea,
  timePresets,
  initialWhen,
}: {
  defaults: WizardDefaults;
  quick: boolean;
  idea: { id: string; title: string } | null;
  /** Computed on the server, so server and browser render the same times. */
  timePresets: TimePreset[];
  initialWhen: TimePreset;
}) {
  const session = usePlanSession();
  const [step, setStep] = useState<Step | 'result'>(quick ? 'result' : 'when');
  const [when, setWhen] = useState(initialWhen);
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
            <BackIcon />
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
            <StepHeading>{session.planning ? 'Planning your date…' : 'Your date'}</StepHeading>
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
            {step === 'when' && <WhenStep presets={timePresets} when={when} setWhen={setWhen} />}
            {step === 'where' && (
              <WhereStep
                home={{ name: defaults.homeName, ...defaults.home }}
                center={center}
                setCenter={setCenter}
                maxDistanceKm={maxDistanceKm}
                setMaxDistanceKm={setMaxDistanceKm}
                autoKm={autoKm}
                startInArea={startInArea}
                setStartInArea={setStartInArea}
                endInArea={endInArea}
                setEndInArea={setEndInArea}
              />
            )}
            {step === 'plans' && (
              <PlansStep picks={picks} setPicks={setPicks} center={center} when={when} />
            )}
            {step === 'how' && (
              <HowStep
                transport={transport}
                setTransport={setTransport}
                budgetEur={budgetEur}
                setBudgetEur={setBudgetEur}
                format={format}
                setFormat={setFormat}
              />
            )}
            {step === 'mood' && <MoodStep moods={moods} setMoods={setMoods} />}
            {step === 'food' && (
              <FoodStep food={food} setFood={setFood} cuisine={cuisine} setCuisine={setCuisine} />
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
