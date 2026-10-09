import { destroySession } from '@/auth/session';

export async function POST() {
  await destroySession();
  return Response.json({ ok: true });
}
