import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { getLimits } from '@/config/limits';
import { listTrips } from '@/trips/service';
import { TripForm } from './trip-form';

// Trip research with web search can take minutes (Vercel Hobby allows up to 300 s).
export const maxDuration = 300;

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const nights = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export default async function TripsPage() {
  await requireSession();
  const trips = await listTrips();
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[34px] leading-tight font-semibold tracking-tight">Trips</h1>
        <p className="text-sm text-mist">A few days away, planned by Claude.</p>
      </header>

      {trips.length > 0 && (
        <section className="flex flex-col gap-3">
          {trips.map((t) => {
            const n = nights(t.startDate, t.endDate);
            return (
              <Link
                key={t.id}
                href={`/trips/${t.id}`}
                className="flex items-center gap-4 rounded-3xl bg-white p-3 pr-5 ring-1 ring-line hover:bg-cream"
              >
                <span className="grid h-16 w-16 shrink-0 place-content-center rounded-2xl bg-butter text-center leading-none">
                  <span className="text-2xl font-semibold">
                    {new Date(t.startDate).getUTCDate()}
                  </span>
                  <span className="text-xs">{MONTH.format(new Date(t.startDate))}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 font-medium">{t.title}</span>
                  <span className="text-sm text-mist">
                    {DAY.format(new Date(t.startDate))} – {DAY.format(new Date(t.endDate))}
                    {n > 0 && `, ${n} ${n === 1 ? 'night' : 'nights'}`}
                  </span>
                </span>
                {t.isFavorite && (
                  <span className="text-lg" aria-label="Favourite">
                    ★
                  </span>
                )}
              </Link>
            );
          })}
        </section>
      )}

      <section className="flex flex-col gap-6">
        <h2 className="text-[26px] leading-tight font-semibold tracking-tight">
          {trips.length > 0 ? 'Plan a new trip' : 'Where shall we go?'}
        </h2>
        <TripForm enabled={getLimits().ai.enabled} />
      </section>
    </div>
  );
}
