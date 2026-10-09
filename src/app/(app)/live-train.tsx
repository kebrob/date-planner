'use client';

import { useEffect, useState } from 'react';
import type { LiveTrain } from '@/rail/live';
import { liveTrainAction } from './actions';

const POLL_MS = 60_000;
const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});

const minutesLate = (planned: string, actual: string) =>
  Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 60_000);

/** Next train of today's date with live delay and platform, refreshed while the page is visible. */
export function LiveTrainCard({ initial }: { initial: LiveTrain }) {
  const [live, setLive] = useState<LiveTrain | null>(initial);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => setLive(await liveTrainAction());
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void poll();
      }, POLL_MS);
    };
    // Catch up immediately when coming back to the app.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!live) return null;
  const { train } = live;
  const late = minutesLate(train.plannedDeparture, train.departure);
  const platformChanged = train.platform !== train.plannedPlatform;

  return (
    <section className="flex flex-col gap-3 rounded-[28px] bg-ink p-5 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-white/60">Your train to {live.destination}</p>
          <p className="text-xl font-semibold">
            {train.line} · {TIME.format(new Date(train.plannedDeparture))}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs whitespace-nowrap ${
            live.cancelled
              ? 'bg-red-500 text-white'
              : late > 0
                ? 'bg-butter text-ink'
                : 'bg-white/15 text-white'
          }`}
        >
          {live.cancelled ? 'Cancelled' : late > 0 ? `+${late} min` : 'On time'}
        </span>
      </div>
      <p className="text-sm text-white/80">
        {train.from.name} → {train.to.name}, arrives {TIME.format(new Date(train.arrival))}
      </p>
      <div className="flex items-center justify-between text-sm">
        <span>
          Leave {TIME.format(new Date(train.leaveAt))}
          {train.platform && (
            <span className={platformChanged ? 'text-butter' : ''}>
              {' '}
              · Platform {train.platform}
              {platformChanged && ' (changed)'}
            </span>
          )}
        </span>
        <span className="text-xs text-white/50">updates every minute</span>
      </div>
    </section>
  );
}
