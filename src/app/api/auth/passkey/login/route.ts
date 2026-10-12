import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { tooManyAttempts } from '@/auth/responses';
import {
  beginLoginAttempt,
  cancelLoginAttempt,
  confirmLoginAttempt,
  createSession,
} from '@/auth/session';
import { verifyAuthentication } from '@/auth/webauthn';

export async function POST(request: Request) {
  const attempt = await beginLoginAttempt('passkey');
  if (!attempt) return tooManyAttempts();
  const response = (await request.json().catch(() => null)) as AuthenticationResponseJSON | null;
  const result = response ? await verifyAuthentication(response).catch(() => null) : null;
  if (result === 'no_challenge') {
    // Nothing was guessed; counting it would let anyone lock a victim out by flooding challenges.
    await cancelLoginAttempt(attempt);
    return Response.json({ error: 'Passkey sign-in expired. Please try again.' }, { status: 401 });
  }
  if (!result) return Response.json({ error: 'Passkey not recognized' }, { status: 401 });
  await confirmLoginAttempt(attempt);
  await createSession(result);
  return Response.json({ ok: true });
}
