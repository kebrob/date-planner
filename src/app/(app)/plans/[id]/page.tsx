import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getSavedPlan, PlanNotFoundError } from '@/planner/saved';
import { SavedPlan } from './saved-plan';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const plan = await getSavedPlan(id).catch((error: unknown) => {
    if (error instanceof PlanNotFoundError) return null;
    throw error;
  });
  if (!plan) notFound();
  return <SavedPlan plan={plan} />;
}
