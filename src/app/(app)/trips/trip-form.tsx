'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { TripInput } from '@/ai/trip';

import { createTripAction } from '../ai-actions';
import { MOODS } from '../moods';
import { TravelIcon, type TravelIconKind } from '../travel-icon';

const TRANSPORTS: {
  value: NonNullable<TripInput['transport']>;
  label: string;
  hint: string;
  icon: TravelIconKind;
}[] = [
  {
    value: 'deutschlandticket',
    label: 'Deutschlandticket',
    hint: 'Regional trains only',
    icon: 'train',
  },
  { value: 'train', label: 'Any train', hint: 'ICE and IC too', icon: 'train' },
  { value: 'bus', label: 'Long-distance bus', hint: 'FlixBus and co.', icon: 'bus' },
  { value: 'car', label: 'Car', hint: 'Our own car', icon: 'car' },
  { value: 'flight', label: 'Flight', hint: 'For far-away places', icon: 'flight' },
];

const SLIDER_MAX = 3000;
// Same upper bound as the server-side trip input validation.
const MAX_BUDGET = 20_000;

// At home is a date idea, not a trip.
const TRIP_MOODS = MOODS.filter((m) => m.tag !== 'home');

const field =
  'w-full rounded-2xl bg-white px-4 py-3 text-[15px] ring-1 ring-line outline-none focus:ring-2 focus:ring-ink';

function isoIn(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const nightsBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

function Group({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function TripForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<TripInput>({
    startDate: isoIn(7),
    endDate: isoIn(9),
    budgetEur: 500,
    transport: null,
    moods: [],
    destination: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nights = nightsBetween(form.startDate, form.endDate);

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createTripAction({
            ...form,
            destination: form.destination || undefined,
            notes: form.notes || undefined,
          });
          if (!result.ok) return setError(result.error);
          router.push(`/trips/${result.data}`);
        });
      }}
    >
      <Group
        title="When"
        aside={
          nights >= 0 && (
            <span className="rounded-full bg-cream px-3 py-1 text-xs">
              {nights === 0 ? 'Day trip' : `${nights} ${nights === 1 ? 'night' : 'nights'}`}
            </span>
          )
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-xs text-mist">
            Leaving
            <input
              type="date"
              className={field}
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-mist">
            Coming back
            <input
              type="date"
              className={field}
              value={form.endDate}
              min={form.startDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </label>
        </div>
      </Group>

      <Group title="Where to">
        <input
          className={field}
          maxLength={100}
          value={form.destination}
          placeholder="Leave empty and Claude picks"
          aria-label="Destination"
          onChange={(e) => setForm({ ...form, destination: e.target.value })}
        />
      </Group>

      <Group
        title="Getting there"
        aside={
          <span className="text-xs text-mist">
            {form.transport ? 'Tap again to clear' : 'Optional'}
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          {TRANSPORTS.map((t) => {
            const selected = form.transport === t.value;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setForm({ ...form, transport: selected ? null : t.value })}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left ${
                  selected ? 'bg-butter' : 'bg-white ring-1 ring-line hover:bg-cream'
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                    selected ? 'bg-ink text-white' : 'bg-cream text-ink'
                  }`}
                >
                  <TravelIcon kind={t.icon} />
                </span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-medium">{t.label}</span>
                  <span className={`text-xs ${selected ? 'text-ink/70' : 'text-mist'}`}>
                    {t.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="What you're into" aside={<span className="text-xs text-mist">Pick any</span>}>
        <div className="grid grid-cols-2 gap-2">
          {TRIP_MOODS.map((m) => {
            const tag = m.tag as TripInput['moods'][number];
            const selected = form.moods.includes(tag);
            return (
              <button
                key={m.tag}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setForm({
                    ...form,
                    moods: selected ? form.moods.filter((x) => x !== tag) : [...form.moods, tag],
                  })
                }
                className={`rounded-full px-4 py-3 text-sm font-medium ${
                  selected
                    ? `${m.tint} ring-2 ring-ink`
                    : 'bg-white ring-1 ring-line hover:bg-cream'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </Group>

      <Group
        title="Budget"
        aside={
          <label className="flex items-center gap-1 rounded-full bg-white py-1 pr-3 pl-3 text-lg font-semibold ring-1 ring-line focus-within:ring-2 focus-within:ring-ink">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_BUDGET}
              step={10}
              value={form.budgetEur}
              onChange={(e) =>
                setForm({
                  ...form,
                  budgetEur: Math.min(MAX_BUDGET, Math.max(0, Math.round(Number(e.target.value)))),
                })
              }
              className="w-20 bg-transparent text-right tabular-nums outline-none"
              aria-label="Total budget for both in euros"
            />
            €
          </label>
        }
      >
        <input
          type="range"
          min={100}
          max={SLIDER_MAX}
          step={50}
          // Typed budgets above the slider range pin the handle to the end.
          value={Math.min(form.budgetEur, SLIDER_MAX)}
          onChange={(e) => setForm({ ...form, budgetEur: Number(e.target.value) })}
          className="accent-ink"
          aria-label="Budget slider"
        />
        <p className="-mt-1 text-xs text-mist">For both of you, including travel and stays.</p>
      </Group>

      <Group title="Anything else">
        <textarea
          className={field}
          rows={3}
          maxLength={300}
          value={form.notes}
          placeholder="e.g. a spa hotel, no long hikes, a nice dinner on Saturday"
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </Group>

      <div className="flex flex-col gap-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          className="rounded-full bg-ink px-5 py-4 font-medium text-white hover:bg-ink/85 disabled:opacity-50"
          disabled={pending || !enabled || nights < 0}
        >
          {pending
            ? 'Claude is researching… this takes about a minute'
            : enabled
              ? 'Plan our trip'
              : 'Claude is turned off'}
        </button>
        <p className="text-center text-xs text-mist">
          Suggestions only, nothing gets booked. Uses Claude with web search, about 10–40 cents.
        </p>
      </div>
    </form>
  );
}
