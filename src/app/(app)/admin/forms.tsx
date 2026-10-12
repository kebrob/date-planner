'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatDuration } from '@/lib/duration';
import { deleteRoutineAction, saveRoutineAction, saveSettingsAction } from './actions';

export const field = 'rounded-lg border border-line bg-transparent px-3 py-2 text-sm';
export const primary =
  'rounded-xl bg-ink px-4 py-2 text-sm text-white disabled:opacity-50 hover:bg-ink/85';
export const secondary =
  'rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-50 hover:bg-cream';

export const TRANSPORTS = [
  { value: 'deutschlandticket', label: 'Deutschlandticket' },
  { value: 'car', label: 'Car' },
  { value: 'walk', label: 'Walk' },
] as const;
// Stored values may still contain 'bike'; it is just no longer offered.
type Transport = 'deutschlandticket' | 'car' | 'walk' | 'bike';

export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = <T,>(
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    success: (data: T) => string,
  ) =>
    startTransition(async () => {
      const result = await action();
      setMessage(
        result.ok ? { ok: true, text: success(result.data) } : { ok: false, text: result.error },
      );
      if (result.ok) router.refresh();
    });
  return { pending, message, run };
}

export function Message({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return <p className={`text-sm ${message.ok ? 'text-mist' : 'text-red-600'}`}>{message.text}</p>;
}

type Settings = {
  homeName: string;
  homePostalCode: string;
  defaultTransport: Transport;
  defaultBudgetEur: number;
  maxRadiusKm: number;
};

export function SettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState(initial);
  const { pending, message, run } = useAction();
  return (
    <form
      className="grid grid-cols-2 gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveSettingsAction(form),
          () => 'Saved.',
        );
      }}
    >
      <label className="flex flex-col gap-1">
        Town
        <input
          className={field}
          value={form.homeName}
          onChange={(e) => setForm({ ...form, homeName: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Postal code
        <input
          className={field}
          inputMode="numeric"
          value={form.homePostalCode}
          onChange={(e) => setForm({ ...form, homePostalCode: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Default transport
        <select
          className={field}
          value={form.defaultTransport}
          onChange={(e) => setForm({ ...form, defaultTransport: e.target.value as Transport })}
        >
          {TRANSPORTS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Default budget (€)
        <input
          className={field}
          type="number"
          min={0}
          value={form.defaultBudgetEur}
          onChange={(e) => setForm({ ...form, defaultBudgetEur: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Max. day-trip radius (km)
        <input
          className={field}
          type="number"
          min={5}
          max={300}
          value={form.maxRadiusKm}
          onChange={(e) => setForm({ ...form, maxRadiusKm: Number(e.target.value) })}
        />
      </label>
      <div className="col-span-2 flex items-center justify-between gap-3">
        <span className="text-xs text-mist">
          The town is stored rounded to ~1 km. Changing it removes the home pin.
        </span>
        <button className={primary} disabled={pending}>
          Save
        </button>
      </div>
      <div className="col-span-2">
        <Message message={message} />
      </div>
    </form>
  );
}

type Routine = {
  id: string;
  transport: Transport;
  description: string;
  firstLegMode: Transport | null;
  firstLegMinutes: number;
  bufferMinutes: number;
  originStation: string | null;
};

const emptyRoutine: Omit<Routine, 'id'> = {
  transport: 'deutschlandticket',
  description: '',
  firstLegMode: null,
  firstLegMinutes: 0,
  bufferMinutes: 0,
  originStation: null,
};

function RoutineForm({ routine, onDone }: { routine: Routine | null; onDone: () => void }) {
  const [form, setForm] = useState<Omit<Routine, 'id'>>(routine ?? emptyRoutine);
  const { pending, message, run } = useAction();
  return (
    <form
      className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveRoutineAction(routine?.id ?? null, form),
          () => {
            onDone();
            return 'Saved.';
          },
        );
      }}
    >
      <label className="col-span-2 flex flex-col gap-1">
        Description
        <input
          className={field}
          required
          value={form.description}
          placeholder="Drive to Rosenheim station, then train"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        For transport
        <select
          className={field}
          value={form.transport}
          onChange={(e) => setForm({ ...form, transport: e.target.value as Transport })}
        >
          {TRANSPORTS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        First leg by
        <select
          className={field}
          value={form.firstLegMode ?? ''}
          onChange={(e) =>
            setForm({ ...form, firstLegMode: (e.target.value || null) as Transport | null })
          }
        >
          <option value="">–</option>
          {TRANSPORTS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        First leg (min)
        <input
          className={field}
          type="number"
          min={0}
          max={120}
          value={form.firstLegMinutes}
          onChange={(e) => setForm({ ...form, firstLegMinutes: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Buffer (min)
        <input
          className={field}
          type="number"
          min={0}
          max={60}
          value={form.bufferMinutes}
          onChange={(e) => setForm({ ...form, bufferMinutes: Number(e.target.value) })}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        Station (optional)
        <input
          className={field}
          value={form.originStation ?? ''}
          onChange={(e) => setForm({ ...form, originStation: e.target.value || null })}
        />
      </label>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" className={secondary} onClick={onDone}>
          Cancel
        </button>
        <button className={primary} disabled={pending}>
          Save
        </button>
      </div>
      <div className="col-span-2">
        <Message message={message} />
      </div>
    </form>
  );
}

export function RoutinesEditor({ routines }: { routines: Routine[] }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { pending, message, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      {routines.map((r) =>
        editing === r.id ? (
          <RoutineForm key={r.id} routine={r} onDone={() => setEditing(null)} />
        ) : (
          <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="font-medium">
                {TRANSPORTS.find((t) => t.value === r.transport)?.label}:
              </span>{' '}
              {r.description} (+{formatDuration(r.firstLegMinutes + r.bufferMinutes)})
            </span>
            <span className="flex gap-2">
              <button type="button" className={secondary} onClick={() => setEditing(r.id)}>
                Edit
              </button>
              <button
                type="button"
                className={`${secondary} text-red-600`}
                disabled={pending}
                onClick={() =>
                  confirm('Delete this routine?') &&
                  run(
                    () => deleteRoutineAction(r.id),
                    () => 'Deleted.',
                  )
                }
              >
                Delete
              </button>
            </span>
          </div>
        ),
      )}
      {editing === 'new' ? (
        <RoutineForm routine={null} onDone={() => setEditing(null)} />
      ) : (
        <button
          type="button"
          className={`${secondary} self-start`}
          onClick={() => setEditing('new')}
        >
          Add routine
        </button>
      )}
      <Message message={message} />
    </div>
  );
}
