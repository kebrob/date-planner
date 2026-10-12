import { tooManyAttempts } from '@/auth/responses';
import { loginBlocked } from '@/auth/session';
import { authenticationOptions, TooManyChallengesError } from '@/auth/webauthn';

export async function POST() {
  if (await loginBlocked('passkey')) return tooManyAttempts();
  try {
    return Response.json(await authenticationOptions());
  } catch (error) {
    if (error instanceof TooManyChallengesError) return tooManyAttempts();
    throw error;
  }
}
