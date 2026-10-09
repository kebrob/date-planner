import { requireSession } from '@/auth/session';
import { listPlans } from '@/planner/service';

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

export default async function PlansPage() {
  await requireSession();
  const plans = await listPlans();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Our dates</h1>
      {plans.length === 0 && <p className="text-stone-500">No saved dates yet.</p>}
      <ul className="flex flex-col gap-3">
        {plans.map((p) => (
          <li key={p.id} className="rounded-2xl bg-white p-4 shadow-sm dark:bg-stone-900">
            <div className="flex justify-between">
              <span className="font-medium">{DAY.format(p.startsAt)}</span>
              <span className="text-sm text-stone-500">~{p.totalCostEur} €</span>
            </div>
            <ul className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              {p.items.map((i) => (
                <li key={i.id}>
                  {TIME.format(i.startsAt)} {i.title}
                  {i.placeName ? ` · ${i.placeName}` : ''}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
