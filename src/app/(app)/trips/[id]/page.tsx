import { timeFormat, shortDayFormat } from '@/lib/time';
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { trainUrl } from '@/planner/view';
import { getTrip } from '@/trips/service';
import type { TripTravel } from '@/trips/trains';
import { TravelIcon } from '../../travel-icon';
import { TripActions } from './trip-actions';

const DAY_NUMBER = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const MODE_LABEL: Record<TripTravel['mode'], string> = {
  train: 'Train',
  bus: 'Bus',
  car: 'Car',
  flight: 'Flight',
  other: 'On the way',
};

const linkPill = 'rounded-full bg-white px-3 py-1 text-xs text-ink ring-1 ring-line hover:bg-cream';

function OpenLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkPill}>
      {children}
    </a>
  );
}

/** A travel leg drawn as a ticket: route on top, tear-off line, details on the stub. */
function Ticket({ leg }: { leg: TripTravel }) {
  const train = leg.train;
  return (
    <article className="relative overflow-hidden rounded-3xl bg-cream">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-white">
            <TravelIcon kind={leg.mode} />
          </span>
          <span className="text-sm text-ink/70">
            {train
              ? `${train.line}, ${shortDayFormat.format(new Date(train.plannedDeparture))}`
              : MODE_LABEL[leg.mode]}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div className="min-w-0">
            {train && (
              <p className="text-[28px] leading-none font-semibold tabular-nums">
                {timeFormat.format(new Date(train.plannedDeparture))}
              </p>
            )}
            <p className="mt-1 truncate text-sm font-medium">{train?.from.name ?? leg.from}</p>
          </div>
          <span className="pb-1 text-ink/40" aria-hidden>
            <TravelIcon kind="other" size={20} />
          </span>
          <div className="min-w-0 text-right">
            {train && (
              <p className="text-[28px] leading-none font-semibold tabular-nums">
                {timeFormat.format(new Date(train.plannedArrival))}
              </p>
            )}
            <p className="mt-1 truncate text-sm font-medium">{train?.to.name ?? leg.to}</p>
          </div>
        </div>
      </div>

      <div className="relative h-0 border-t-2 border-dashed border-ink/15" aria-hidden>
        <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-paper" />
        <span className="absolute -top-3 -right-3 h-6 w-6 rounded-full bg-paper" />
      </div>

      <div className="flex flex-col gap-3 p-5">
        {train?.platform && (
          <p className="text-sm">
            Platform {train.platform}
            {!train.regional && (
              <span className="text-amber-700"> · not covered by the Deutschlandticket</span>
            )}
          </p>
        )}
        {leg.notes && <p className="text-sm text-ink/70">{leg.notes}</p>}
        {(train || leg.link) && (
          <div className="flex gap-2">
            {train && <OpenLink href={trainUrl(train)}>bahn.de</OpenLink>}
            <OpenLink href={leg.link}>Details</OpenLink>
          </div>
        )}
      </div>
    </article>
  );
}

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) notFound();
  const { plan } = trip;
  const nights = Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86_400_000);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-[34px] leading-[1.1] font-semibold tracking-tight">{plan.title}</h1>
          <TripActions id={trip.id} isFavorite={trip.isFavorite} />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-butter px-3 py-1">{plan.destination}</span>
          <span className="rounded-full bg-cream px-3 py-1">
            {SHORT_DAY.format(new Date(trip.startDate))} –{' '}
            {SHORT_DAY.format(new Date(trip.endDate))}
            {nights > 0 && `, ${nights} ${nights === 1 ? 'night' : 'nights'}`}
          </span>
          {plan.estimatedTotalEur !== null && (
            <span className="rounded-full bg-cream px-3 py-1">
              ~{plan.estimatedTotalEur} € total
            </span>
          )}
        </div>
        <p className="text-[15px] leading-relaxed">{plan.summary}</p>
        <p className="text-xs text-mist">
          Suggestions only, nothing is booked. Check prices and availability via the links.
        </p>
      </header>

      {plan.travel.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Getting there and back</h2>
          {plan.travel.map((leg, i) => (
            <Ticket key={i} leg={leg} />
          ))}
        </section>
      )}

      {plan.stays.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Where to stay</h2>
          {plan.stays.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-3xl bg-white p-5 ring-1 ring-line"
            >
              <div className="min-w-0">
                <p className="font-medium">{s.name}</p>
                <p className="text-sm text-mist">{s.area}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {s.pricePerNightEur !== null && (
                  <span className="text-sm font-medium whitespace-nowrap">
                    ~{s.pricePerNightEur} € / night
                  </span>
                )}
                <OpenLink href={s.link}>View</OpenLink>
              </div>
            </div>
          ))}
        </section>
      )}

      {plan.days.map((day) => (
        <section key={day.date} className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <span className="text-[44px] leading-none font-semibold tabular-nums">
              {DAY_NUMBER.format(new Date(day.date))}
            </span>
            <div>
              <p className="text-sm text-mist">
                {WEEKDAY.format(new Date(day.date))}, {MONTH.format(new Date(day.date))}
              </p>
              <h2 className="font-semibold">{day.title}</h2>
            </div>
          </div>
          <ol className="ml-[11px] flex flex-col gap-5 border-l-2 border-line pl-6">
            {day.items.map((item, i) => (
              <li key={i} className="relative">
                <span
                  className="absolute top-1.5 -left-[31px] h-3 w-3 rounded-full bg-butter ring-4 ring-paper"
                  aria-hidden
                />
                {item.time && <p className="text-xs text-mist tabular-nums">{item.time}</p>}
                <p className="font-medium">{item.title}</p>
                <p className="text-sm text-mist">{item.description}</p>
                {item.link && (
                  <div className="mt-2">
                    <OpenLink href={item.link}>Details</OpenLink>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}

      {plan.tips.length > 0 && (
        <section className="flex flex-col gap-3 rounded-3xl bg-mint/50 p-5">
          <h2 className="text-lg font-semibold">Good to know</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {plan.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
