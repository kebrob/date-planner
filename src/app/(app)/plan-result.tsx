'use client';

import type { PlanView } from '@/planner/view';
import { TravelIcon } from './travel-icon';

const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const WARNINGS: Record<PlanView['warnings'][number], string> = {
  forecast_unreliable: 'Weather forecast is still uncertain this far ahead.',
  forecast_unavailable: 'No weather forecast available for this date yet.',
  opening_hours_unknown: 'Opening hours unknown for some places — check before you go.',
  place_lookup_limit_reached:
    'Searched as many places as one plan allows, so some ideas were skipped. Re-roll for others.',
  fallback_used: 'Nothing else fit — here is a cozy fallback.',
  over_budget: 'Slightly over budget so the day does not end early.',
  required_skipped: 'Some requested stops did not fit in time, budget or nearby places.',
  chosen_time_moved:
    'Getting there takes longer, so a chosen stop starts a bit later than you set.',
  places_daily_limit:
    'Daily Google place search limit reached – fewer venues available until tomorrow.',
  food_skipped: 'Food did not fit the budget or time — raise the budget or re-roll.',
  train_times_adjusted: 'Times were moved to match real train departures.',
  train_ticket_needed:
    'Only a long-distance train fits – it is not covered by the Deutschlandticket.',
  train_late_return: 'The last fitting train gets you home after the planned end.',
  trains_unavailable: 'Live train times are unavailable right now – train times are estimates.',
};

type Leg = NonNullable<PlanView['travelHome']>;

// Name the plan view gives the home point.
const HOME = 'Home';

const MODE: Record<Leg['mode'], string> = {
  walk: 'walk',
  bike: 'by bike',
  car: 'drive',
  local_transit: 'by bus or tram',
  train: 'by train',
};

const delayMinutes = (planned: string, actual: string) =>
  Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 60_000);

type Train = NonNullable<Leg['train']>;

function TrainLine({ train }: { train: Train }) {
  return (
    <span className="text-ink">
      {train.line} · {TIME.format(new Date(train.plannedDeparture))} {train.from.name} →{' '}
      {TIME.format(new Date(train.plannedArrival))} {train.to.name}
    </span>
  );
}

function TrainInfo({ train, transfers = [] }: { train: Train; transfers?: Train[] }) {
  const delay = delayMinutes(train.plannedDeparture, train.departure);
  const longDistance = [train, ...transfers].some((t) => !t.regional);
  return (
    <span className="flex min-w-0 flex-col">
      <TrainLine train={train} />
      {transfers.map((t) => (
        <span key={t.stopId} className="flex flex-col">
          <span className="text-xs">Change at {t.from.name}</span>
          <TrainLine train={t} />
        </span>
      ))}
      <span className="text-xs">
        Leave {TIME.format(new Date(train.leaveAt))}
        {train.expected ? (
          <span> · expected times, confirmed the day before</span>
        ) : (
          train.platform && ` · Platform ${train.platform}`
        )}
        {delay > 0 && <span className="text-amber-700"> · +{delay} min</span>}
        {longDistance && (
          <span className="text-amber-700"> · not covered by the Deutschlandticket</span>
        )}
      </span>
    </span>
  );
}

/** Travel between two stops, shown as a quiet connector between the cards. */
function LegRow({ leg }: { leg: Leg }) {
  const suffix = leg.to === HOME ? ' home' : leg.from === HOME ? ' from home' : '';
  return (
    <div className="flex items-center gap-3 px-2 text-sm text-mist">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream text-ink">
        <TravelIcon kind={leg.mode} />
      </span>
      {leg.train ? (
        <TrainInfo train={leg.train} transfers={leg.transfers} />
      ) : (
        <span>
          {leg.minutes} min {MODE[leg.mode]}
          {suffix}
        </span>
      )}
      {leg.trainUrl ? (
        <a href={leg.trainUrl} target="_blank" rel="noreferrer" className={`ml-auto ${linkPill}`}>
          bahn.de
        </a>
      ) : (
        leg.directionsUrl && (
          <a
            href={leg.directionsUrl}
            target="_blank"
            rel="noreferrer"
            className={`ml-auto ${linkPill}`}
          >
            Directions
          </a>
        )
      )}
    </div>
  );
}

/** Google names often carry a slogan ("Inn – the best in town"); keep the name part. */
function shortName(name: string) {
  const [first] = name.split(/\s[-–|]\s/);
  return first && first.length >= 3 ? first : name;
}

function weatherLine(w: PlanView['weather']) {
  if (w.reliability === 'none' || w.minTempC === null) return null;
  const temp = `${Math.round(w.minTempC)}–${Math.round(w.maxTempC ?? w.minTempC)} °C`;
  const conditions = w.conditions ?? [];
  const sky = conditions.includes('snow')
    ? '🌨️ Snow likely'
    : !w.dry
      ? '🌧️ Rain likely'
      : conditions.includes('sunny')
        ? '☀️ Sunny'
        : '⛅ Dry';
  return `${sky}, ${temp}${conditions.includes('windy') ? ', windy' : ''}`;
}

type Props = {
  plan: PlanView;
  pending: boolean;
  onRerollItem?: (index: number) => void;
  onRemoveItem?: (index: number) => void;
  onSwap?: (index: number, placeId: string) => void;
  /** Replace an item with something the user picks. */
  onChooseItem?: (index: number) => void;
  /** Extra content inside an item card, e.g. a rating or a weather hint. */
  renderItemExtra?: (index: number) => React.ReactNode;
  /** Action buttons below the plan. */
  children?: React.ReactNode;
};

const linkPill =
  'inline-flex min-h-10 items-center rounded-full bg-white px-3.5 text-sm text-ink ring-1 ring-line hover:bg-cream';

type Item = PlanView['items'][number];

const iconButton =
  'grid h-11 w-11 place-items-center rounded-full bg-cream text-ink hover:bg-butter disabled:opacity-50';

function RerollIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
    </svg>
  );
}

function ChooseIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

/**
 * One stop: the time column carries the timeline, the venue name opens Maps, other venues are
 * quiet rows to switch to, the edit actions round buttons at the bottom.
 */
function StopCard({
  item,
  pending,
  onReroll,
  onChoose,
  onRemove,
  onSwap,
  extra,
}: {
  item: Item;
  pending: boolean;
  onReroll?: () => void;
  onChoose?: () => void;
  onRemove?: () => void;
  onSwap?: (placeId: string) => void;
  extra?: React.ReactNode;
}) {
  const venue = item.place ? shortName(item.place.name) : item.placeName;
  const where = item.atHome
    ? 'At home'
    : item.locationHint
      ? `${item.locationHint}, no fixed place`
      : null;
  const others = onSwap ? item.alternatives : [];

  return (
    <article className="overflow-hidden rounded-3xl bg-white ring-1 ring-line">
      <div className="flex gap-4 p-5">
        <p className="flex w-12 shrink-0 flex-col tabular-nums">
          <span className="text-[17px] leading-tight font-semibold">
            {TIME.format(new Date(item.start))}
          </span>
          <span className="text-sm text-mist">{TIME.format(new Date(item.end))}</span>
        </p>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[17px] leading-tight font-semibold">{item.title}</h3>
            <span className="shrink-0 text-sm text-mist tabular-nums">~{item.costEur} €</span>
          </div>
          {venue && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
              {item.place?.mapsUrl ? (
                <a
                  href={item.place.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="py-1 underline decoration-line decoration-2 underline-offset-4 hover:decoration-butter-deep"
                >
                  {venue}
                </a>
              ) : (
                <span>{venue}</span>
              )}
              {item.place?.rating && <span className="text-mist">★ {item.place.rating}</span>}
              {item.place?.website && (
                // Extra padding keeps a finger-sized target without adding height.
                <a
                  href={item.place.website}
                  target="_blank"
                  rel="noreferrer"
                  className="-my-3 py-3 text-sm text-mist underline underline-offset-4 hover:text-ink"
                >
                  Website
                </a>
              )}
            </p>
          )}
          {where && <p className="text-[15px] text-mist">{where}</p>}
          {item.openingHoursUnknown && (
            <p className="text-sm text-mist">Hours unknown – check before you go</p>
          )}
          {item.preparation && <p className="text-sm text-mist">Prep: {item.preparation}</p>}
        </div>
      </div>
      {others.length > 0 && (
        <ul
          className="mx-5 -mt-2 mb-3 flex flex-col border-t border-line"
          aria-label="Other places"
        >
          {others.map((alt) => (
            <li key={alt.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                disabled={pending}
                onClick={() => onSwap!(alt.id)}
                aria-label={`Go to ${alt.name} instead`}
                className="group flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-mist hover:text-ink disabled:opacity-50"
              >
                <span className="min-w-0 py-2">
                  or {shortName(alt.name)}
                  {alt.rating && <span className="whitespace-nowrap"> ★ {alt.rating}</span>}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                  aria-hidden
                >
                  <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {extra && <div className="-mt-2 px-5 pb-5">{extra}</div>}

      {(onReroll || onChoose || onRemove) && (
        <div className="-mt-1 flex justify-end gap-2 px-5 pb-4">
          {onChoose && (
            <button
              type="button"
              onClick={onChoose}
              disabled={pending}
              className={iconButton}
              aria-label={`Choose something instead of ${item.title}`}
            >
              <ChooseIcon />
            </button>
          )}
          {onReroll && (
            <button
              type="button"
              onClick={onReroll}
              disabled={pending}
              className={iconButton}
              aria-label={`Re-roll ${item.title}`}
            >
              <RerollIcon />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className={iconButton}
              aria-label={`Remove ${item.title}`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="m3 3 6 6M9 3 3 9" />
              </svg>
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function PlanResult({
  plan,
  pending,
  onRerollItem,
  onRemoveItem,
  onSwap,
  onChooseItem,
  renderItemExtra,
  children,
}: Props) {
  const first = plan.items[0];
  const weather = weatherLine(plan.weather);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {first ? DAY.format(new Date(first.start)) : 'Your plan'}
          </h2>
          {weather && <p className="text-sm text-mist">{weather}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">~{plan.totalCostEur} €</p>
          {plan.overBudgetEur > 0 && (
            <p className="text-xs text-amber-700">+{plan.overBudgetEur} € over budget</p>
          )}
        </div>
      </header>

      <ol className="flex flex-col gap-3">
        {plan.items.map((item, index) => (
          <li key={`${item.activityId}-${index}`} className="flex flex-col gap-3">
            {item.travelBefore && <LegRow leg={item.travelBefore} />}
            <StopCard
              item={item}
              pending={pending}
              onReroll={onRerollItem && (() => onRerollItem(index))}
              onChoose={onChooseItem && (() => onChooseItem(index))}
              onRemove={
                onRemoveItem && plan.items.length > 1 ? () => onRemoveItem(index) : undefined
              }
              onSwap={onSwap && ((placeId) => onSwap(index, placeId))}
              extra={renderItemExtra?.(index)}
            />
          </li>
        ))}
      </ol>

      {plan.travelHome && <LegRow leg={plan.travelHome} />}

      {plan.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-700">
          {plan.warnings.map((w) => (
            <li key={w}>⚠︎ {WARNINGS[w]}</li>
          ))}
        </ul>
      )}

      {children}
    </section>
  );
}
