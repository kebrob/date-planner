import { requireSession } from '@/auth/session';
import { listUpcoming } from '@/planner/saved';
import { loadPlannerDefaults } from '@/planner/service';
import { PlanCard } from './plan-card';
import { Planner } from './planner';

export default async function HomePage() {
  await requireSession();
  const [defaults, upcoming] = await Promise.all([loadPlannerDefaults(), listUpcoming()]);
  return (
    <div className="flex flex-col gap-6">
      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Coming up</h2>
          {upcoming.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </section>
      )}
      <Planner defaults={{ transport: defaults.transport, budgetEur: defaults.budgetEur }} />
    </div>
  );
}
