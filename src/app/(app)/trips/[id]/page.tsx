import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getTrip } from '@/trips/service';
import { TripActions } from './trip-actions';

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const MODE = { train: '🚆', car: '🚗', flight: '✈️', bus: '🚌', other: '➜' } as const;

function ExternalLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-rose-600 underline">
      {children}
    </a>
  );
}

const card = 'flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900';

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) notFound();
  const { plan } = trip;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{plan.title}</h1>
          <p className="text-sm text-stone-500">
            {plan.destination}
            {plan.estimatedTotalEur !== null ? ` · ~${plan.estimatedTotalEur} € total` : ''}
          </p>
        </div>
        <TripActions id={trip.id} isFavorite={trip.isFavorite} />
      </header>

      <p className="text-sm">{plan.summary}</p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Suggestion only – nothing is booked. Check prices and availability via the links.
      </p>

      {plan.travel.length > 0 && (
        <section className={card}>
          <h2 className="font-medium">Getting there</h2>
          {plan.travel.map((t, i) => (
            <p key={i} className="text-sm">
              {MODE[t.mode]}{' '}
              <ExternalLink href={t.link}>
                {t.from} → {t.to}
              </ExternalLink>
              <span className="block text-xs text-stone-500">{t.notes}</span>
            </p>
          ))}
        </section>
      )}

      {plan.stays.length > 0 && (
        <section className={card}>
          <h2 className="font-medium">Where to stay</h2>
          {plan.stays.map((s, i) => (
            <p key={i} className="text-sm">
              <ExternalLink href={s.link}>{s.name}</ExternalLink>
              <span className="text-stone-500">
                {' '}
                · {s.area}
                {s.pricePerNightEur !== null ? ` · ~${s.pricePerNightEur} €/night` : ''}
              </span>
            </p>
          ))}
        </section>
      )}

      {plan.days.map((day) => (
        <section key={day.date} className={card}>
          <h2 className="font-medium">
            {DAY.format(new Date(day.date))} · {day.title}
          </h2>
          <ol className="flex flex-col gap-2">
            {day.items.map((item, i) => (
              <li key={i} className="text-sm">
                {item.time && <span className="text-rose-600">{item.time} </span>}
                <ExternalLink href={item.link}>{item.title}</ExternalLink>
                <span className="block text-xs text-stone-500">{item.description}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {plan.tips.length > 0 && (
        <section className={card}>
          <h2 className="font-medium">Tips</h2>
          <ul className="list-disc pl-5 text-sm">
            {plan.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
