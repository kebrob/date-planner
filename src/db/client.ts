import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Pool (WebSocket) instead of the HTTP driver because the cost guard needs interactive transactions.
  return drizzle({ client: new Pool({ connectionString: url }), schema });
}

let instance: ReturnType<typeof createDb> | undefined;

export function getDb() {
  instance ??= createDb();
  return instance;
}

export type Db = ReturnType<typeof getDb>;
