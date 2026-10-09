'use client';

import { useState } from 'react';
import { autoAreaRadiusKm, autoRadiusKm } from '@/core/planner/build-plan';
import {
  addMinutes,
  fromLocal,
  localParts,
  minutesBetween,
  toLocalDate,
  toLocalTime,
} from '@/lib/time';
import type { PlanInput } from '@/planner/service';
import { LocationPicker, type Point } from './location-picker';

type Transport = PlanInput['transport'];
type Format = NonNullable<PlanInput['format']>;

const PREFERENCES = [
  'indoor',
  'outdoor',
  'active',
  'chill',
  'social',
  'romantic',
  'culture',
  'creative',
  'home',
];
const TRANSPORTS: { value: Transport; label: string }[] = [
  { value: 'deutschlandticket', label: 'Deutschlandticket' },
  { value: 'car', label: 'Car' },
  { value: 'walk', label: 'Walk' },
];
type Food = NonNullable<PlanInput['food']>;
type Cuisine = NonNullable<PlanInput['cuisine']>;
const CUISINE_OPTIONS: { value: Cuisine | null; label: string }[] = [
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
const FOODS: { value: Food; label: string }[] = [
  { value: 'auto', label: 'Surprise me' },
  { value: 'none', label: 'No food' },
  { value: 'snack', label: 'Coffee / ice cream' },
  { value: 'meal', label: 'Proper meal' },
];
function Info({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="What does this mean?"
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-stone-400 text-[10px] text-stone-500 hover:border-rose-400 hover:text-rose-600"
      >
        i
      </button>
      {open && <span className="mt-1 block text-xs text-stone-500">{children}</span>}
    </>
  );
}

const FORMATS: { value: Format | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'single', label: 'One thing' },
  { value: 'evening', label: 'Activity + food' },
  { value: 'day', label: 'Full day' },
];

const pad = (n: number) => String(n).padStart(2, '0');

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

// Built on Europe/Berlin wall-clock time so server render and browser agree.
function timeWindow(date: string, startHour: number, durationHours: number) {
  const day = startHour >= 24 ? addDays(date, 1) : date;
  const startTime = `${pad(startHour % 24)}:00`;
  const end = addMinutes(fromLocal(day, startTime), durationHours * 60);
  return { date: day, startTime, endDate: toLocalDate(end), endTime: toLocalTime(end) };
}

function presets() {
  const now = new Date();
  const today = toLocalDate(now);
  const { hour, weekday } = localParts(now);
  const daysToSaturday = (6 - weekday + 7) % 7 || 7;
  return [
    { label: 'Now', ...timeWindow(today, hour + 1, 5) },
    { label: 'Tonight', ...timeWindow(today, Math.max(18, hour + 1), 5) },
    { label: 'Tomorrow evening', ...timeWindow(addDays(today, 1), 18, 5) },
    { label: 'Saturday', ...timeWindow(addDays(today, daysToSaturday), 10, 12) },
  ];
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition ${
    active
      ? 'border-rose-600 bg-rose-600 text-white'
      : 'border-stone-300 text-stone-700 hover:border-rose-400 hover:text-rose-600 dark:border-stone-700 dark:text-stone-300'
  }`;

const field = 'rounded-lg border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700';

export type PlannerDefaults = {
  transport: Transport;
  budgetEur: number;
  homeName: string;
  home: { lat: number; lng: number };
  maxRadiusKm: number;
};

/** The manual planner form; plans without Claude. */
export function Filters({
  defaults,
  pending,
  onPlan,
}: {
  defaults: PlannerDefaults;
  pending: boolean;
  onPlan: (input: PlanInput) => void;
}) {
  const [when, setWhen] = useState(() => presets()[1]!);
  const [budgetEur, setBudget] = useState(defaults.budgetEur);
  const [transport, setTransport] = useState<Transport>(defaults.transport);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [format, setFormat] = useState<Format | 'auto'>('auto');
  const [food, setFood] = useState<Food>('auto');
  const [cuisine, setCuisine] = useState<Cuisine | null>(null);
  const [center, setCenter] = useState<Point | null>(null);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | null>(null);
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
  const baseInput = (): PlanInput => ({
    date: when.date,
    startTime: when.startTime,
    endDate: when.endDate,
    endTime: when.endTime,
    budgetEur,
    transport,
    preferences,
    format: format === 'auto' ? undefined : format,
    food,
    cuisine: food === 'none' || food === 'snack' ? null : cuisine,
    areaPoint: center ?? undefined,
    maxDistanceKm,
    excludeActivityIds: [],
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {presets().map((p) => (
          <button
            key={p.label}
            type="button"
            className={chip(
              p.date === when.date && p.startTime === when.startTime && p.endTime === when.endTime,
            )}
            onClick={() => setWhen(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            className={field}
            value={when.date}
            onChange={(e) => setWhen({ ...when, date: e.target.value })}
          />
          <input
            type="time"
            className={field}
            value={when.startTime}
            onChange={(e) => setWhen({ ...when, startTime: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Until
          <input
            type="date"
            className={field}
            value={when.endDate}
            onChange={(e) => setWhen({ ...when, endDate: e.target.value })}
          />
          <input
            type="time"
            className={field}
            value={when.endTime}
            onChange={(e) => setWhen({ ...when, endTime: e.target.value })}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Budget for both: {budgetEur} €
        <input
          type="range"
          min={0}
          max={300}
          step={5}
          value={budgetEur}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="accent-rose-600"
        />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span>
          Where?
          <Info>
            Without a town, places are searched around {defaults.homeName}. Auto radius: the trip
            there takes at most about a quarter of your time window (15–120 min); around a chosen
            town a few km depending on transport. Move the slider for a custom radius. Later stops
            stay close to each other.
          </Info>
        </span>
        <LocationPicker
          home={{ name: defaults.homeName, ...defaults.home }}
          center={center}
          onCenterChange={setCenter}
          radiusKm={maxDistanceKm}
          onRadiusChange={setMaxDistanceKm}
          autoRadiusKm={autoKm}
        />
      </div>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm">
          Transportation
          <Info>
            Used for the whole date; each leg is adjusted automatically: short hops (under ~1.2 km)
            are walked. Deutschlandticket: public transport within ~25 km, regional trains beyond
            (no ICE/IC). Car: you drive between stops. Walk: everything within ~4 km of home.
          </Info>
        </legend>
        {TRANSPORTS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={chip(transport === t.value)}
            onClick={() => setTransport(t.value)}
          >
            {t.label}
          </button>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm">Mood</legend>
        {PREFERENCES.map((p) => (
          <button
            key={p}
            type="button"
            className={chip(preferences.includes(p))}
            onClick={() =>
              setPreferences((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
            }
          >
            {p}
          </button>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm">Food</legend>
        {FOODS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={chip(food === f.value)}
            onClick={() => setFood(f.value)}
          >
            {f.label}
          </button>
        ))}
      </fieldset>

      {(food === 'auto' || food === 'meal') && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm">Cuisine</legend>
          {CUISINE_OPTIONS.map((c) => (
            <button
              key={c.label}
              type="button"
              className={chip(cuisine === c.value)}
              onClick={() => setCuisine(c.value)}
            >
              {c.label}
            </button>
          ))}
        </fieldset>
      )}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm">Plan size</legend>
        {FORMATS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={chip(format === f.value)}
            onClick={() => setFormat(f.value)}
          >
            {f.label}
          </button>
        ))}
      </fieldset>

      <button
        type="button"
        onClick={() => onPlan(baseInput())}
        disabled={pending}
        className="rounded-xl bg-rose-600 px-4 py-3 font-medium text-white disabled:opacity-50 hover:bg-rose-700"
      >
        {pending ? 'Planning…' : 'Plan our date'}
      </button>
    </section>
  );
}
