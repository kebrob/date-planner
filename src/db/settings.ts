import { eq } from 'drizzle-orm';
import { getDb } from './client';
import { settings } from './schema';

/** The app has exactly one settings row. */
export const isSettingsRow = eq(settings.id, 1);

export type Settings = typeof settings.$inferSelect;

/** Null only before the database is seeded. */
export async function findSettings(): Promise<Settings | null> {
  const [row] = await getDb().select().from(settings).where(isSettingsRow).limit(1);
  return row ?? null;
}

export async function loadSettings(): Promise<Settings> {
  const row = await findSettings();
  if (!row) throw new Error('Settings missing – run npm run db:seed');
  return row;
}
