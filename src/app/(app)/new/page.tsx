import { requireSession } from '@/auth/session';
import { getActivity } from '@/admin/service';
import { loadPlannerDefaults } from '@/planner/service';
import { outingPreset, presets } from './presets';
import { Wizard } from './wizard';

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ quick?: string; idea?: string }>;
}) {
  await requireSession();
  const { quick, idea: ideaId } = await searchParams;
  const [defaults, idea] = await Promise.all([
    loadPlannerDefaults(),
    ideaId ? getActivity(ideaId) : Promise.resolve(null),
  ]);
  const now = new Date();
  return (
    <Wizard
      // Remount when switching between quick and step-by-step from the same page.
      key={`${quick ?? ''}-${ideaId ?? ''}`}
      defaults={{
        transport: defaults.transport,
        budgetEur: defaults.budgetEur,
        homeName: defaults.homeName,
        home: defaults.home,
        maxRadiusKm: defaults.maxRadiusKm,
      }}
      quick={quick === '1'}
      timePresets={presets(now)}
      initialWhen={outingPreset(now)}
      idea={idea && idea.status === 'active' ? { id: idea.id, title: idea.title } : null}
    />
  );
}
