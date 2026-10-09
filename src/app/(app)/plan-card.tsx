import Link from 'next/link';
import type { PlanSummary } from '@/planner/saved';

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
      className="flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-sm ring-rose-300 hover:shadow-md hover:ring-1 dark:bg-stone-900 dark:ring-rose-800"
    >
      <span className="flex justify-between">
        <span className="font-medium">
          {plan.isFavorite ? '★ ' : ''}
          {DAY.format(plan.startsAt)} · {TIME.format(plan.startsAt)}
          {plan.areaName ? ` · ${plan.areaName.split(',')[0]}` : ''}
        </span>
        <span className="text-sm text-stone-500">~{plan.totalCostEur} €</span>
      </span>
      <span className="text-sm text-stone-600 dark:text-stone-400">{plan.titles.join(' → ')}</span>
    </Link>
  );
}
