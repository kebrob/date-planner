// Usage: npm run db:seed [-- --update]
// Inserts missing settings/routines and seed activities (matched by title).
// With --update, existing seed activities are overwritten with the seed values.
import { existsSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { activity, settings, travelRoutine } from '../src/db/schema.ts';
import { seedActivities, seedRoutines, seedSettings } from '../src/db/seed-data.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const update = process.argv.includes('--update');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

try {
  await db.insert(settings).values(seedSettings).onConflictDoNothing();

  const [routines] = await db.select({ n: count() }).from(travelRoutine);
  if (routines?.n === 0) await db.insert(travelRoutine).values(seedRoutines);

  const existing = new Set(
    (await db.select({ title: activity.title }).from(activity)).map((r) => r.title),
  );
  let inserted = 0;
  let updated = 0;
  for (const seed of seedActivities) {
    if (!existing.has(seed.title)) {
      await db.insert(activity).values(seed);
      inserted++;
    } else if (update) {
      await db.update(activity).set(seed).where(eq(activity.title, seed.title));
      updated++;
    }
  }
  console.log(`Activities: ${inserted} inserted, ${updated} updated.`);
} finally {
  await pool.end();
}
