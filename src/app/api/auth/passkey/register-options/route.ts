import { hasValidSession } from '@/auth/session';
import { registrationOptions } from '@/auth/webauthn';

// Adding a passkey requires an existing session (first login via emergency password).
export async function POST() {
  if (!(await hasValidSession())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await registrationOptions());
}
