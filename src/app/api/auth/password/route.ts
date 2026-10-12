import { z } from 'zod';
import { verifyPassword } from '@/auth/password';
import { tooManyAttempts } from '@/auth/rate-limit';
import { beginLoginAttempt, confirmLoginAttempt, createSession } from '@/auth/session';

const body = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const attempt = await beginLoginAttempt('password');
  if (!attempt) return tooManyAttempts();
  const parsed = body.safeParse(await request.json().catch(() => null));
  const storedHash = process.env.AUTH_PASSWORD_HASH;
  const ok = Boolean(
    parsed.success && storedHash && (await verifyPassword(parsed.data.password, storedHash)),
  );
  if (!ok) return Response.json({ error: 'Invalid password' }, { status: 401 });
  await confirmLoginAttempt(attempt);
  await createSession();
  return Response.json({ ok: true });
}
