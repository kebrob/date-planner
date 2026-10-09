import { loginBlocked } from '@/auth/session';
import { authenticationOptions } from '@/auth/webauthn';

export async function POST() {
  if (await loginBlocked()) {
    return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
  }
  return Response.json(await authenticationOptions());
}
