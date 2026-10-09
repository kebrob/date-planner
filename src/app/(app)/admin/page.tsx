import Link from 'next/link';
import { getSettings, listRoutines, usageOverview } from '@/admin/service';
import { requireSession } from '@/auth/session';
import { RoutinesEditor, SettingsForm } from './forms';

function Meter({
  label,
  value,
  max,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-stone-500">
          {unit === '$' ? `$${value.toFixed(2)} / $${max}` : `${value} / ${max}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-stone-200 dark:bg-stone-800">
        <div
          className={`h-2 rounded-full ${pct >= 90 ? 'bg-red-600' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const card = 'flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900';

export default async function AdminPage() {
  await requireSession();
  const [settings, routines, usage] = await Promise.all([
    getSettings(),
    listRoutines(),
    usageOverview(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link
          href="/admin/activities"
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white"
        >
          Manage activities
        </Link>
      </div>

      <section className={card}>
        <h2 className="font-medium">Usage</h2>
        <Meter
          label="Claude today"
          value={usage.anthropic.today.costUsd}
          max={usage.anthropic.dailyBudgetUsd}
          unit="$"
        />
        <Meter
          label="Claude this month"
          value={usage.anthropic.month.costUsd}
          max={usage.anthropic.monthlyBudgetUsd}
          unit="$"
        />
        <Meter
          label="Google Places today"
          value={usage.googlePlaces.today.calls}
          max={usage.googlePlaces.dailyLimit}
          unit="calls"
        />
        <p className="text-xs text-stone-500">
          Google Places this month: {usage.googlePlaces.month.calls} calls (1,000 free per type).
          {!usage.anthropic.enabled && ' Claude is disabled (AI_ENABLED=false).'}
          {usage.googlePlaces.provider !== 'google' && ' Places run on OpenStreetMap only.'} Limits
          are configured via environment variables, see docs/betrieb/kostenlimits.md.
        </p>
      </section>

      <section className={card}>
        <h2 className="font-medium">Home &amp; defaults</h2>
        <SettingsForm
          initial={{
            homeName: settings.homeName,
            homePostalCode: settings.homePostalCode,
            defaultTransport: settings.defaultTransport,
            defaultBudgetEur: settings.defaultBudgetEur,
            maxRadiusKm: settings.maxRadiusKm,
          }}
        />
      </section>

      <section className={card}>
        <h2 className="font-medium">Travel routines</h2>
        <p className="text-xs text-stone-500">
          Added to every trip leaving from home with that transport, e.g. driving to the station
          first.
        </p>
        <RoutinesEditor routines={routines} />
      </section>
    </div>
  );
}
