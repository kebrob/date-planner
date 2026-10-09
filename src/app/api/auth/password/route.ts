import { z } from 'zod';
import { verifyPassword } from '@/auth/password';
import { createSession, loginBlocked, recordLoginAttempt } from '@/auth/session';

const body = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  if (await loginBlocked()) {
    return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  const storedHash = process.env.AUTH_PASSWORD_HASH;
  const ok = Boolean(
    parsed.success && storedHash && (await verifyPassword(parsed.data.password, storedHash)),
  );
  await recordLoginAttempt(ok);
  if (!ok) return Response.json({ error: 'Invalid password' }, { status: 401 });
  await createSession();
  return Response.json({ ok: true });
}
