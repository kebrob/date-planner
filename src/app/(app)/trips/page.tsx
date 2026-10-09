import Link from 'next/link';
import { requireSession } from '@/auth/session';
import { getLimits } from '@/config/limits';
import { listTrips } from '@/trips/service';
import { TripForm } from './trip-form';

// Trip research with web search can take minutes (Vercel Hobby allows up to 300 s).
export const maxDuration = 300;

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default async function TripsPage() {
  await requireSession();
  const trips = await listTrips();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Trips</h1>
        <p className="text-sm text-stone-500">
          Multi-day suggestions with stays, travel and links. Nothing is booked.
        </p>
      </div>
      <TripForm enabled={getLimits().ai.enabled} />
      {trips.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Saved trips</h2>
          {trips.map((t) => (
            <Link
              key={t.id}
              href={`/trips/${t.id}`}
              className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-rose-300 hover:shadow-md hover:ring-1 dark:bg-stone-900 dark:ring-rose-800"
            >
              <span className="font-medium">
                {t.isFavorite ? '★ ' : ''}
                {t.title}
              </span>
              <span className="block text-stone-500">
                {DAY.format(new Date(t.startDate))} – {DAY.format(new Date(t.endDate))}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
