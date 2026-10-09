import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { createSession, loginBlocked, recordLoginAttempt } from '@/auth/session';
import { verifyAuthentication } from '@/auth/webauthn';

export async function POST(request: Request) {
  if (await loginBlocked()) {
    return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
  }
  const response = (await request.json().catch(() => null)) as AuthenticationResponseJSON | null;
  const ok = Boolean(response && (await verifyAuthentication(response).catch(() => false)));
  await recordLoginAttempt(ok);
  if (!ok) return Response.json({ error: 'Passkey not recognized' }, { status: 401 });
  await createSession();
  return Response.json({ ok: true });
}
