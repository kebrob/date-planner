export const SIGN_IN_AGAIN = 'Please sign out and sign in again to manage passkeys.';

export function tooManyAttempts(): Response {
  return Response.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
}

export function signInAgain(): Response {
  return Response.json({ error: SIGN_IN_AGAIN }, { status: 403 });
}
