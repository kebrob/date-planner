import Link from 'next/link';
import { getSettings, listRoutines, usageOverview } from '@/admin/service';
import { requireSession } from '@/auth/session';
import { RoutinesEditor, SettingsForm } from './forms';
import { HomePin } from './home-pin';

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
        <span className="text-mist">
          {unit === '$' ? `$${value.toFixed(2)} / $${max}` : `${value} / ${max}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-line">
        <div
          className={`h-2 rounded-full ${pct >= 90 ? 'bg-red-600' : pct >= 60 ? 'bg-amber-500' : 'bg-ink'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const card = 'flex flex-col gap-4 rounded-3xl bg-white p-5 ring-1 ring-line';

export default async function AdminPage() {
  await requireSession();
  const [settings, routines, usage] = await Promise.all([
    getSettings(),
    listRoutines(),
    usageOverview(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">Admin</h1>
        <div className="flex items-center gap-3 whitespace-nowrap">
          <Link href="/settings/security" className="text-sm text-mist underline">
            Security &amp; passkeys
          </Link>
          <Link
            href="/admin/activities"
            className="rounded-xl bg-ink px-4 py-2 text-sm text-white hover:bg-ink/85"
          >
            Manage activities
          </Link>
        </div>
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
        <p className="text-xs text-mist">
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
        <h2 className="font-medium">Home pin</h2>
        <HomePin
          town={{ lat: settings.homeLat, lng: settings.homeLng }}
          pin={
            settings.homeExactLat !== null && settings.homeExactLng !== null
              ? { lat: settings.homeExactLat, lng: settings.homeExactLng }
              : null
          }
        />
      </section>

      <section className={card}>
        <h2 className="font-medium">Travel routines</h2>
        <p className="text-xs text-mist">
          Added to every trip leaving from home with that transport, e.g. driving to the station
          first.
        </p>
        <RoutinesEditor routines={routines} />
      </section>
    </div>
  );
}
