'use client';

import type { PlanView } from '@/planner/view';

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
  places_daily_limit:
    'Daily Google place search limit reached – fewer venues available until tomorrow.',
  food_skipped: 'Food did not fit the budget or time — raise the budget or re-roll.',
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

const MODE_ICON: Record<Leg['mode'], React.ReactNode> = {
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.5" />
      <path d="m10 21 2-6 3 3v3M12 15l-1-5 3-1 2 3h3M11 10l-3 2v3" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="m6 16 4-7h5l3 7M10 9l2 7h-6M14 6h2" />
    </>
  ),
  car: (
    <>
      <path d="M4 16v-3l2-5h12l2 5v3zM4 13h16" />
      <circle cx="8" cy="16.5" r="1.5" />
      <circle cx="16" cy="16.5" r="1.5" />
    </>
  ),
  local_transit: (
    <>
      <rect x="6" y="3" width="12" height="14" rx="3" />
      <path d="M6 10h12M9 21l1.5-4M15 21l-1.5-4" />
    </>
  ),
  train: (
    <>
      <rect x="6" y="3" width="12" height="14" rx="3" />
      <path d="M6 10h12M9 21l1.5-4M15 21l-1.5-4M10 13.5h.01M14 13.5h.01" />
    </>
  ),
};

/** Travel between two stops, shown as a quiet connector between the cards. */
function LegRow({ leg }: { leg: Leg }) {
  const suffix = leg.to === HOME ? ' home' : leg.from === HOME ? ' from home' : '';
  return (
    <div className="flex items-center gap-3 px-2 text-sm text-mist">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream text-ink">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {MODE_ICON[leg.mode]}
        </svg>
      </span>
      <span>
        {leg.minutes} min {MODE[leg.mode]}
        {suffix}
      </span>
      {leg.directionsUrl && (
        <a
          href={leg.directionsUrl}
          target="_blank"
          rel="noreferrer"
          className={`ml-auto ${linkPill}`}
        >
          Directions
        </a>
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
  return `${w.dry ? '☀️ Dry' : '🌧️ Rain likely'}, ${temp}`;
}

type Props = {
  plan: PlanView;
  pending: boolean;
  onRerollItem?: (index: number) => void;
  onRemoveItem?: (index: number) => void;
  onSwap?: (index: number, placeId: string) => void;
  /** Action buttons below the plan. */
  children?: React.ReactNode;
};

const linkPill = 'rounded-full bg-white px-3 py-1 text-xs text-ink ring-1 ring-line hover:bg-cream';
const smallButton = 'rounded-full bg-cream px-3 py-1 text-xs hover:bg-butter disabled:opacity-50';
const iconButton =
  'grid h-8 w-8 place-items-center rounded-full bg-cream text-ink hover:bg-butter disabled:opacity-50';

export function PlanResult({ plan, pending, onRerollItem, onRemoveItem, onSwap, children }: Props) {
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
            <div className="flex items-start justify-between gap-3 rounded-3xl bg-white p-5 ring-1 ring-line">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-ink">
                  {TIME.format(new Date(item.start))} – {TIME.format(new Date(item.end))}
                </p>
                <h3 className="font-medium">{item.title}</h3>
                {item.place ? (
                  <p className="text-sm text-mist">
                    {shortName(item.place.name)}
                    {item.place.rating ? ` · ★ ${item.place.rating}` : ''}
                    {item.openingHoursUnknown ? ' · hours unknown' : ''}
                  </p>
                ) : (
                  item.placeName && <p className="text-sm text-mist">{item.placeName}</p>
                )}
                {item.alternatives.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1 text-xs text-mist">
                    or:
                    {item.alternatives.map((alt) =>
                      onSwap ? (
                        <button
                          key={alt.id}
                          type="button"
                          disabled={pending}
                          onClick={() => onSwap(index, alt.id)}
                          className={smallButton}
                        >
                          {shortName(alt.name)}
                          {alt.rating ? ` ★ ${alt.rating}` : ''}
                        </button>
                      ) : (
                        <span key={alt.id}>{shortName(alt.name)}</span>
                      ),
                    )}
                  </p>
                )}
                {item.locationHint && (
                  <p className="text-sm text-mist">{item.locationHint} · no fixed place</p>
                )}
                {item.atHome && <p className="text-sm text-mist">At home</p>}
                {item.preparation && <p className="text-xs text-mist">Prep: {item.preparation}</p>}
                {(item.place?.mapsUrl || item.place?.website) && (
                  <div className="mt-1 flex gap-2">
                    {item.place.mapsUrl && (
                      <a
                        href={item.place.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={linkPill}
                      >
                        Maps
                      </a>
                    )}
                    {item.place.website && (
                      <a
                        href={item.place.website}
                        target="_blank"
                        rel="noreferrer"
                        className={linkPill}
                      >
                        Website
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-sm whitespace-nowrap">~{item.costEur} €</span>
                <div className="flex gap-1">
                  {onRerollItem && (
                    <button
                      type="button"
                      onClick={() => onRerollItem(index)}
                      disabled={pending}
                      className={iconButton}
                      aria-label={`Re-roll ${item.title}`}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
                      </svg>
                    </button>
                  )}
                  {onRemoveItem && plan.items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveItem(index)}
                      disabled={pending}
                      className={iconButton}
                      aria-label={`Remove ${item.title}`}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        aria-hidden
                      >
                        <path d="m3 3 6 6M9 3 3 9" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
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
