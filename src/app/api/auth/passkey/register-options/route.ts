import { signInAgain } from '@/auth/responses';
import { hasFreshSession, hasValidSession } from '@/auth/session';
import { registrationOptions } from '@/auth/webauthn';

// Adding a passkey requires a recent sign-in (the first one via the emergency password).
export async function POST() {
  if (!(await hasValidSession())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await hasFreshSession())) return signInAgain();
  return Response.json(await registrationOptions());
}
