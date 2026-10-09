import { desc } from 'drizzle-orm';
import { requireSession } from '@/auth/session';
import { getDb } from '@/db/client';
import { passkey } from '@/db/schema';
import { AddPasskey, LogoutButton } from './client';

export default async function SecurityPage() {
  await requireSession();
  const passkeys = await getDb()
    .select({ id: passkey.id, deviceName: passkey.deviceName, lastUsedAt: passkey.lastUsedAt })
    .from(passkey)
    .orderBy(desc(passkey.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Security</h1>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Passkeys</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {passkeys.length === 0 && <li className="text-stone-500">No passkeys yet.</li>}
          {passkeys.map((p) => (
            <li key={p.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
              {p.deviceName}
              <span className="block text-stone-500">
                {p.lastUsedAt
                  ? `Last used ${p.lastUsedAt.toLocaleDateString('en-GB')}`
                  : 'Never used'}
              </span>
            </li>
          ))}
        </ul>
        <AddPasskey />
      </section>
      <LogoutButton />
    </div>
  );
}
