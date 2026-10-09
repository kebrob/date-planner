import Link from 'next/link';
import { listActivities } from '@/admin/service';
import { requireSession } from '@/auth/session';
import { getLimits } from '@/config/limits';
import { ActivityRow, IdeasPanel } from './client';

export const maxDuration = 120;

export default async function ActivitiesPage() {
  await requireSession();
  const activities = await listActivities();
  const groups = [
    { title: 'Drafts – review before they are suggested', status: 'draft' as const },
    { title: 'Active', status: 'active' as const },
    { title: 'Blocked – never suggested', status: 'blocked' as const },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activities</h1>
        <Link
          href="/admin/activities/new"
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white"
        >
          New activity
        </Link>
      </div>

      <IdeasPanel aiEnabled={getLimits().ai.enabled} />

      {groups.map((g) => {
        const rows = activities.filter((a) => a.status === g.status);
        if (rows.length === 0 && g.status !== 'active') return null;
        return (
          <section key={g.status} className="flex flex-col gap-2">
            <h2 className="font-medium">
              {g.title} <span className="text-stone-500">({rows.length})</span>
            </h2>
            <ul className="flex flex-col divide-y divide-stone-200 rounded-2xl bg-white shadow-sm dark:divide-stone-800 dark:bg-stone-900">
              {rows.map((a) => (
                <ActivityRow
                  key={a.id}
                  activity={{
                    id: a.id,
                    title: a.title,
                    category: a.category,
                    tags: a.tags,
                    costMinEur: a.costMinEur,
                    costMaxEur: a.costMaxEur,
                    durationMinutes: a.durationMinutes,
                    status: a.status,
                    source: a.source,
                    placeQuery: a.placeQuery,
                    atHome: a.atHome,
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
