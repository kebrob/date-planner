'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MOOD_TAGS } from '@/core/planner/types';
import type { TripInput } from '@/ai/trip';
import { createTripAction } from '../ai-actions';

const field =
  'rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-sm dark:border-stone-700';
const TRANSPORTS: { value: TripInput['transport']; label: string }[] = [
  { value: 'deutschlandticket', label: 'Deutschlandticket' },
  { value: 'train', label: 'Any train' },
  { value: 'car', label: 'Car' },
  { value: 'flight', label: 'Flight ok' },
];

function isoIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function TripForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<TripInput>({
    startDate: isoIn(7),
    endDate: isoIn(9),
    budgetEur: 500,
    transport: 'deutschlandticket',
    moods: [],
    destination: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${active ? 'border-rose-600 bg-rose-600 text-white' : 'border-stone-300 hover:border-rose-400 dark:border-stone-700'}`;

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900"
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
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            className={field}
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Until
          <input
            type="date"
            className={field}
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Total budget (€, both)
          <input
            type="number"
            min={0}
            step={50}
            className={field}
            value={form.budgetEur}
            onChange={(e) => setForm({ ...form, budgetEur: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          Destination (optional)
          <input
            className={field}
            maxLength={100}
            value={form.destination}
            placeholder="Surprise us"
            onChange={(e) => setForm({ ...form, destination: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {TRANSPORTS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={chip(form.transport === t.value)}
            onClick={() => setForm({ ...form, transport: t.value })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {MOOD_TAGS.filter((m) => m !== 'home').map((m) => (
          <button
            key={m}
            type="button"
            className={chip(form.moods.includes(m))}
            onClick={() =>
              setForm({
                ...form,
                moods: form.moods.includes(m)
                  ? form.moods.filter((x) => x !== m)
                  : [...form.moods, m],
              })
            }
          >
            {m}
          </button>
        ))}
      </div>
      <textarea
        className={field}
        rows={2}
        maxLength={300}
        value={form.notes}
        placeholder="Anything else? e.g. spa hotel, no long hikes"
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        className="rounded-xl bg-rose-600 px-4 py-3 font-medium text-white disabled:opacity-50 hover:bg-rose-700"
        disabled={pending || !enabled}
      >
        {pending
          ? 'Claude is researching… (up to a minute)'
          : enabled
            ? 'Plan our trip'
            : 'Claude is disabled'}
      </button>
      <p className="text-xs text-stone-500">
        Uses Claude with web search: typically 10–40 cents per trip.
      </p>
    </form>
  );
}
