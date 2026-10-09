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
  place_lookup_limit_reached: 'Place search limit reached; some ideas were skipped.',
  fallback_used: 'Nothing else fit — here is a cozy fallback.',
  over_budget: 'Slightly over budget so the day does not end early.',
  required_skipped: 'Some requested stops did not fit in time, budget or nearby places.',
  places_daily_limit:
    'Daily Google place search limit reached – fewer venues available until tomorrow.',
  food_skipped: 'Food did not fit the budget or time — raise the budget or re-roll.',
};

type Leg = NonNullable<PlanView['travelHome']>;

const MODE: Record<Leg['mode'], string> = {
  walk: '🚶 walk',
  bike: '🚲 bike',
  car: '🚗 drive',
  local_transit: '🚇 public transport',
  train: '🚆 train',
};

function LegLine({ leg, className }: { leg: Leg; className?: string }) {
  return (
    <p className={`text-xs text-mist ${className ?? ''}`}>
      {MODE[leg.mode]} · {leg.minutes} min · {leg.from} → {leg.to}
      {leg.directionsUrl && (
        <>
          {' · '}
          <a href={leg.directionsUrl} target="_blank" rel="noreferrer" className="underline">
            route
          </a>
        </>
      )}
    </p>
  );
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
          <li
            key={`${item.activityId}-${index}`}
            className="rounded-3xl bg-white p-5 ring-1 ring-line"
          >
            {item.travelBefore && <LegLine leg={item.travelBefore} className="mb-2" />}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-ink">
                  {TIME.format(new Date(item.start))} – {TIME.format(new Date(item.end))}
                </p>
                <h3 className="font-medium">{item.title}</h3>
                {item.place ? (
                  <p className="text-sm text-mist">
                    {item.place.name}
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
                          {alt.name}
                          {alt.rating ? ` ★ ${alt.rating}` : ''}
                        </button>
                      ) : (
                        <span key={alt.id}>{alt.name}</span>
                      ),
                    )}
                  </p>
                )}
                {item.locationHint && (
                  <p className="text-sm text-mist">{item.locationHint} · no fixed place</p>
                )}
                {item.atHome && <p className="text-sm text-mist">At home</p>}
                {item.preparation && <p className="text-xs text-mist">Prep: {item.preparation}</p>}
                <div className="mt-1 flex gap-3 text-sm">
                  {item.place?.mapsUrl && (
                    <a
                      href={item.place.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink underline"
                    >
                      Details
                    </a>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-sm">~{item.costEur} €</span>
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

      {plan.travelHome && <LegLine leg={plan.travelHome} className="text-center" />}

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
