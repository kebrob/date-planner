'use client';

import { useState } from 'react';
import type { PlanInput } from '@/planner/service';
import { CloseIcon } from '../icons';
import { LocationPicker, type Point } from '../location-picker';
import { MOODS } from '../moods';
import { StopPicker, type PickedStop } from '../stop-picker';
import { TRANSPORTS } from '../transports';
import { Choice, field, OptionRow, StepHeading } from './controls';
import { Face } from './face';
import type { TimePreset } from './presets';

type Transport = PlanInput['transport'];
type Food = NonNullable<PlanInput['food']>;
type Cuisine = NonNullable<PlanInput['cuisine']>;
export type Format = NonNullable<PlanInput['format']>;
type Setter<T> = (value: T) => void;

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

export function WhenStep({
  presets: timePresets,
  when,
  setWhen,
}: {
  presets: TimePreset[];
  when: TimePreset;
  setWhen: Setter<TimePreset>;
}) {
  return (
    <>
      <>
        <StepHeading>When&apos;s your date?</StepHeading>
        <div className="grid grid-cols-2 gap-2.5">
          {timePresets.map((p) => (
            <Choice
              key={p.label}
              selected={
                p.date === when.date && p.startTime === when.startTime && p.endTime === when.endTime
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
    </>
  );
}

export function WhereStep({
  home,
  center,
  setCenter,
  maxDistanceKm,
  setMaxDistanceKm,
  autoKm,
  startInArea,
  setStartInArea,
  endInArea,
  setEndInArea,
}: {
  home: Point;
  center: Point | null;
  setCenter: Setter<Point | null>;
  maxDistanceKm: number | null;
  setMaxDistanceKm: Setter<number | null>;
  autoKm: number;
  startInArea: boolean;
  setStartInArea: Setter<boolean>;
  endInArea: boolean;
  setEndInArea: Setter<boolean>;
}) {
  return (
    <>
      <>
        <StepHeading>Where should it be?</StepHeading>
        <p className="-mt-3 text-sm text-mist">
          Around {home.name} unless you pick a town or tap the map. “Fit to time” keeps the trip
          there to about a quarter of your time.
        </p>
        <LocationPicker
          home={home}
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
    </>
  );
}

export function PlansStep({
  picks,
  setPicks,
  center,
  when,
}: {
  picks: PickedStop[];
  setPicks: (update: (current: PickedStop[]) => PickedStop[]) => void;
  center: Point | null;
  when: TimePreset;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <>
        <StepHeading>Anything set already?</StepHeading>
        <p className="-mt-3 text-sm text-mist">
          Add what you want to do for sure, at a set time if you like. The planner fits the rest
          around it.
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
                  <CloseIcon />
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
    </>
  );
}

export function HowStep({
  transport,
  setTransport,
  budgetEur,
  setBudgetEur,
  format,
  setFormat,
}: {
  transport: Transport;
  setTransport: Setter<Transport>;
  budgetEur: number;
  setBudgetEur: Setter<number>;
  format: Format | null;
  setFormat: Setter<Format | null>;
}) {
  return (
    <>
      <>
        <StepHeading>How do you get around?</StepHeading>
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
    </>
  );
}

export function MoodStep({
  moods,
  setMoods,
}: {
  moods: string[];
  setMoods: (update: (current: string[]) => string[]) => void;
}) {
  const activeMood = MOODS.find((m) => m.tag === moods.at(-1));
  return (
    <>
      <>
        <StepHeading>How are you feeling?</StepHeading>
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
    </>
  );
}

export function FoodStep({
  food,
  setFood,
  cuisine,
  setCuisine,
}: {
  food: Food;
  setFood: Setter<Food>;
  cuisine: Cuisine | null;
  setCuisine: Setter<Cuisine | null>;
}) {
  return (
    <>
      <>
        <StepHeading>Hungry?</StepHeading>
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
    </>
  );
}
