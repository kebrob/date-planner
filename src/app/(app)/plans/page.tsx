import { requireSession } from '@/auth/session';
import { listPlans, type PlanSummary } from '@/planner/saved';
import { PlanCard } from '../plan-card';

function Section({ title, plans, empty }: { title: string; plans: PlanSummary[]; empty: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">{title}</h2>
      {plans.length === 0 && <p className="text-sm text-stone-500">{empty}</p>}
      {plans.map((p) => (
        <PlanCard key={p.id} plan={p} />
      ))}
    </section>
  );
}

export default async function PlansPage() {
  await requireSession();
  const { upcoming, favourites, past } = await listPlans();
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Our dates</h1>
      <Section title="Upcoming" plans={upcoming} empty="Nothing planned yet." />
      <Section title="Favourites" plans={favourites} empty="Star a plan to keep it here." />
      <Section title="Past dates" plans={past} empty="No past dates yet." />
    </div>
  );
}
