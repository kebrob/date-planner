import { requireSession } from '@/auth/session';
import { loadPlannerDefaults } from '@/planner/service';
import { Planner } from './planner';

export default async function HomePage() {
  await requireSession();
  const defaults = await loadPlannerDefaults();
  return <Planner defaults={{ transport: defaults.transport, budgetEur: defaults.budgetEur }} />;
}
