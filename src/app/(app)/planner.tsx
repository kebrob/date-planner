'use client';

import { useState, useTransition } from 'react';
import { addMinutes, fromLocal, localParts, toLocalDate, toLocalTime } from '@/lib/time';
import type { PlanInput } from '@/planner/service';
import type { PlanView } from '@/planner/view';
import { acceptPlanAction, generatePlanAction } from './actions';
import { PlanResult } from './plan-result';

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
  { value: 'bike', label: 'Bike' },
  { value: 'walk', label: 'Walk' },
];
type Food = NonNullable<PlanInput['food']>;
const FOODS: { value: Food; label: string }[] = [
  { value: 'auto', label: 'Surprise me' },
  { value: 'none', label: 'No food' },
  { value: 'snack', label: 'Coffee / ice cream' },
  { value: 'meal', label: 'Proper meal' },
];
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
      : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'
  }`;

const field = 'rounded-lg border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700';

export function Planner({ defaults }: { defaults: { transport: Transport; budgetEur: number } }) {
  const [when, setWhen] = useState(() => presets()[1]!);
  const [budgetEur, setBudget] = useState(defaults.budgetEur);
  const [transport, setTransport] = useState<Transport>(defaults.transport);
  const [preferences, setPreferences] = useState<string[]>([]);
  const [format, setFormat] = useState<Format | 'auto'>('auto');
  const [food, setFood] = useState<Food>('auto');
  const [area, setArea] = useState('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [lastInput, setLastInput] = useState<PlanInput | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    area: area.trim() || undefined,
    excludeActivityIds: [],
  });

  function run(input: PlanInput) {
    setMessage(null);
    startTransition(async () => {
      const result = await generatePlanAction(input);
      if (!result.ok) return setMessage(result.error);
      setPlan(result.data);
      setLastInput(input);
    });
  }

  const generate = () => {
    setExcluded([]);
    run(baseInput());
  };

  const rerollAll = () => {
    if (!plan || !lastInput) return;
    const next = [...new Set([...excluded, ...plan.items.map((i) => i.activityId)])];
    setExcluded(next);
    run({ ...lastInput, excludeActivityIds: next, keep: undefined });
  };

  const rerollItem = (index: number) => {
    if (!plan || !lastInput) return;
    const next = [...new Set([...excluded, plan.items[index]!.activityId])];
    setExcluded(next);
    const keep = Object.fromEntries(
      plan.items
        .map((item, i) => [String(i), { activityId: item.activityId, place: item.place }] as const)
        .filter(([i]) => Number(i) !== index),
    );
    run({ ...lastInput, excludeActivityIds: next, keep });
  };

  const accept = () => {
    if (!plan || !lastInput) return;
    startTransition(async () => {
      const result = await acceptPlanAction(lastInput, plan);
      setMessage(result.ok ? 'Saved! Have fun 💕' : result.error);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900">
        <div className="flex flex-wrap gap-2">
          {presets().map((p) => (
            <button
              key={p.label}
              type="button"
              className={chip(
                p.date === when.date &&
                  p.startTime === when.startTime &&
                  p.endTime === when.endTime,
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

        <label className="flex flex-col gap-1 text-sm">
          Where?
          <input
            type="text"
            className={field}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Near home – or a town, e.g. München"
            maxLength={100}
          />
        </label>

        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm">Getting there</legend>
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
                setPreferences((cur) =>
                  cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
                )
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
          onClick={generate}
          disabled={pending}
          className="rounded-xl bg-rose-600 px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Planning…' : 'Plan our date'}
        </button>
      </section>

      {message && (
        <p className="text-center text-sm text-stone-600 dark:text-stone-400">{message}</p>
      )}

      {plan && (
        <PlanResult
          plan={plan}
          pending={pending}
          onRerollAll={rerollAll}
          onRerollItem={rerollItem}
          onAccept={accept}
        />
      )}
    </div>
  );
}
