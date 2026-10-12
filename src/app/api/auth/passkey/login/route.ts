import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { tooManyAttempts } from '@/auth/rate-limit';
import { beginLoginAttempt, confirmLoginAttempt, createSession } from '@/auth/session';
import { verifyAuthentication } from '@/auth/webauthn';

export async function POST(request: Request) {
  const attempt = await beginLoginAttempt('passkey');
  if (!attempt) return tooManyAttempts();
  const response = (await request.json().catch(() => null)) as AuthenticationResponseJSON | null;
  const ok = Boolean(response && (await verifyAuthentication(response).catch(() => false)));
  if (!ok) return Response.json({ error: 'Passkey not recognized' }, { status: 401 });
  await confirmLoginAttempt(attempt);
  await createSession();
  return Response.json({ ok: true });
}
