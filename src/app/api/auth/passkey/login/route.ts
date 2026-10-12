import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { tooManyAttempts } from '@/auth/responses';
import { beginLoginAttempt, confirmLoginAttempt, createSession } from '@/auth/session';
import { verifyAuthentication } from '@/auth/webauthn';

export async function POST(request: Request) {
  const attempt = await beginLoginAttempt('passkey');
  if (!attempt) return tooManyAttempts();
  const response = (await request.json().catch(() => null)) as AuthenticationResponseJSON | null;
  const passkeyId = response ? await verifyAuthentication(response).catch(() => null) : null;
  if (!passkeyId) return Response.json({ error: 'Passkey not recognized' }, { status: 401 });
  await confirmLoginAttempt(attempt);
  await createSession(passkeyId);
  return Response.json({ ok: true });
}
