import { desc } from 'drizzle-orm';
import { requireSession } from '@/auth/session';
import { getDb } from '@/db/client';
import { passkey } from '@/db/schema';
import { AddPasskey, DeletePasskey, LogoutButton } from './client';

export default async function SecurityPage() {
  await requireSession();
  const passkeys = await getDb()
    .select({ id: passkey.id, deviceName: passkey.deviceName, lastUsedAt: passkey.lastUsedAt })
    .from(passkey)
    .orderBy(desc(passkey.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] font-semibold tracking-tight">Security</h1>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Passkeys</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {passkeys.length === 0 && <li className="text-mist">No passkeys yet.</li>}
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-line p-3"
            >
              <span>
                {p.deviceName}
                <span className="block text-mist">
                  {p.lastUsedAt
                    ? `Last used ${p.lastUsedAt.toLocaleDateString('en-GB')}`
                    : 'Never used'}
                </span>
              </span>
              <DeletePasskey id={p.id} name={p.deviceName} />
            </li>
          ))}
        </ul>
        <AddPasskey />
      </section>
      <LogoutButton />
    </div>
  );
}
