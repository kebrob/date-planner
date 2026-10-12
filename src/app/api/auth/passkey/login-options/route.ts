import { tooManyAttempts } from '@/auth/responses';
import { loginBlocked } from '@/auth/session';
import { authenticationOptions } from '@/auth/webauthn';

export async function POST() {
  if (await loginBlocked('passkey')) return tooManyAttempts();
  return Response.json(await authenticationOptions());
}
