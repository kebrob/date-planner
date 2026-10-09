import { notFound } from 'next/navigation';
import { getActivity, toActivityForm } from '@/admin/service';
import { requireSession } from '@/auth/session';
import { ActivityEditor } from './editor';

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (id === 'new') return <ActivityEditor id={null} initial={null} />;
  const row = await getActivity(id);
  if (!row) notFound();
  return <ActivityEditor id={row.id} initial={toActivityForm(row)} />;
}
