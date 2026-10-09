'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ActivityForm } from '@/admin/service';
import { CUISINES, MOOD_TAGS } from '@/core/planner/types';
import { PLACE_TYPES } from '@/ports/place-types';
import { saveActivityAction } from '../../actions';
import { field, Message, primary, secondary, TRANSPORTS } from '../../forms';

const TIMES = ['morning', 'afternoon', 'evening', 'night'] as const;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

const empty: ActivityForm = {
  title: '',
  description: '',
  kind: 'activity',
  cuisine: null,
  tags: [],
  costMinEur: 0,
  costMaxEur: 0,
  durationMinutes: 90,
  transports: [],
  atHome: false,
  placeType: null,
  placeQuery: null,
  dryOnly: false,
  minTempC: null,
  timesOfDay: [],
  seasons: [],
  preparation: null,
  status: 'active',
};

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(toggle(value, o))}
          className={`rounded-full border px-2 py-1 text-xs ${
            value.includes(o)
              ? 'border-rose-600 bg-rose-600 text-white'
              : 'border-stone-300 dark:border-stone-700'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function ActivityEditor({
  id,
  initial,
}: {
  id: string | null;
  initial: ActivityForm | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ActivityForm>(initial ?? empty);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ActivityForm>(key: K, value: ActivityForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const label = 'flex flex-col gap-1 text-sm';

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveActivityAction(id, form);
          if (!result.ok) return setMessage({ ok: false, text: result.error });
          router.push('/admin/activities');
          router.refresh();
        });
      }}
    >
      <h1 className="text-xl font-semibold">{id ? 'Edit activity' : 'New activity'}</h1>

      <label className={label}>
        Title
        <input
          className={field}
          required
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </label>
      <label className={label}>
        Description
        <textarea
          className={field}
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Kind
          <select
            className={field}
            value={form.kind}
            onChange={(e) => set('kind', e.target.value as ActivityForm['kind'])}
          >
            <option value="activity">Activity</option>
            <option value="meal">Meal</option>
            <option value="snack">Snack (coffee, ice cream …)</option>
          </select>
        </label>
        {form.kind === 'meal' && (
          <label className={label}>
            Cuisine
            <select
              className={field}
              value={form.cuisine ?? ''}
              onChange={(e) => set('cuisine', (e.target.value || null) as ActivityForm['cuisine'])}
            >
              <option value="">–</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={label}>
          Cost min (€, both)
          <input
            className={field}
            type="number"
            min={0}
            value={form.costMinEur}
            onChange={(e) => set('costMinEur', Number(e.target.value))}
          />
        </label>
        <label className={label}>
          Cost max (€, both)
          <input
            className={field}
            type="number"
            min={0}
            value={form.costMaxEur}
            onChange={(e) => set('costMaxEur', Number(e.target.value))}
          />
        </label>
        <label className={label}>
          Duration (min)
          <input
            className={field}
            type="number"
            min={15}
            max={720}
            value={form.durationMinutes}
            onChange={(e) => set('durationMinutes', Number(e.target.value))}
          />
        </label>
        <label className={label}>
          Status
          <select
            className={field}
            value={form.status}
            onChange={(e) => set('status', e.target.value as ActivityForm['status'])}
          >
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
      </div>

      <div className={label}>
        Mood tags
        <Chips
          options={MOOD_TAGS}
          value={form.tags as (typeof MOOD_TAGS)[number][]}
          onChange={(v) => set('tags', v)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-rose-600"
          checked={form.atHome}
          onChange={(e) => set('atHome', e.target.checked)}
        />
        At home (no venue, no travel)
      </label>

      {!form.atHome && (
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Venue type
            <select
              className={field}
              value={form.placeType ?? ''}
              onChange={(e) =>
                set('placeType', (e.target.value || null) as ActivityForm['placeType'])
              }
            >
              <option value="">No venue (e.g. a walk)</option>
              {PLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          {form.placeType && (
            <label className={label}>
              Search term
              <input
                className={field}
                value={form.placeQuery ?? ''}
                placeholder="e.g. Minigolf"
                onChange={(e) => set('placeQuery', e.target.value || null)}
              />
            </label>
          )}
          <div className={`${label} col-span-2`}>
            Only with (empty = any)
            <Chips
              options={TRANSPORTS.map((t) => t.value)}
              value={form.transports}
              onChange={(v) => set('transports', v)}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-rose-600"
            checked={form.dryOnly}
            onChange={(e) => set('dryOnly', e.target.checked)}
          />
          Only when dry
        </label>
        <label className={label}>
          Min. temperature (°C)
          <input
            className={field}
            type="number"
            value={form.minTempC ?? ''}
            onChange={(e) => set('minTempC', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
      </div>

      <div className={label}>
        Time of day (empty = any)
        <Chips
          options={TIMES}
          value={form.timesOfDay ?? []}
          onChange={(v) => set('timesOfDay', v)}
        />
      </div>
      <div className={label}>
        Seasons (empty = all)
        <Chips options={SEASONS} value={form.seasons ?? []} onChange={(v) => set('seasons', v)} />
      </div>

      <label className={label}>
        Preparation (optional)
        <input
          className={field}
          value={form.preparation ?? ''}
          onChange={(e) => set('preparation', e.target.value || null)}
        />
      </label>

      <Message message={message} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={secondary}
          onClick={() => router.push('/admin/activities')}
        >
          Cancel
        </button>
        <button className={primary} disabled={pending}>
          Save
        </button>
      </div>
    </form>
  );
}
