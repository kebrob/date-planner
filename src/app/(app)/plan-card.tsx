import Link from 'next/link';
import type { PlanSummary } from '@/planner/saved';
import { ratingEmoji } from './rating-options';

const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
});

export function PlanCard({ plan }: { plan: PlanSummary }) {
  return (
    <Link
      href={`/plans/${plan.id}`}
      className="flex flex-col gap-1 rounded-3xl bg-white p-5 ring-1 ring-line hover:ring-butter-deep"
    >
      <span className="flex justify-between">
        <span className="font-medium">
          {plan.isFavorite ? '★ ' : ''}
          {DAY.format(plan.startsAt)} · {TIME.format(plan.startsAt)}
          {plan.areaName ? ` · ${plan.areaName.split(',')[0]}` : ''}
        </span>
        <span className="text-sm text-mist">
          {plan.notHappened ? "didn't happen · " : ''}
          {ratingEmoji(plan.rating) ? `${ratingEmoji(plan.rating)} · ` : ''}~{plan.totalCostEur} €
        </span>
      </span>
      <span className="text-sm text-mist">{plan.titles.join(' → ')}</span>
    </Link>
  );
}
