import { requireSession } from '@/auth/session';
import { loadHistory } from '@/chat/service';
import { getLimits } from '@/config/limits';
import { listUpcoming } from '@/planner/saved';
import { loadPlannerDefaults } from '@/planner/service';
import { PlanCard } from './plan-card';
import { PlanWorkspace } from './workspace';

// Claude tool loops can take a while; applies to the server actions used on this page.
export const maxDuration = 120;

export default async function HomePage() {
  await requireSession();
  const [defaults, upcoming, chatHistory] = await Promise.all([
    loadPlannerDefaults(),
    listUpcoming(),
    loadHistory(),
  ]);
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
      <PlanWorkspace
        defaults={{
          transport: defaults.transport,
          budgetEur: defaults.budgetEur,
          homeName: defaults.homeName,
          home: defaults.home,
          maxRadiusKm: defaults.maxRadiusKm,
        }}
        chatHistory={chatHistory}
        aiEnabled={getLimits().ai.enabled}
      />
    </div>
  );
}
