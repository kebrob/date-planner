import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { eq, lt, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { getDb } from '@/db/client';
import { authChallenge, passkey } from '@/db/schema';
import { newToken } from './tokens';

const CHALLENGE_COOKIE = 'dp_challenge';
const CHALLENGE_PATH = '/api/auth';
const CHALLENGE_TTL_MS = 5 * 60_000;

function relyingParty() {
  const rpID = process.env.WEBAUTHN_RP_ID;
  const origin = process.env.WEBAUTHN_ORIGIN;
  if (!rpID || !origin) throw new Error('WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be set');
  return { rpID, origin, rpName: 'Date Planner' };
}

// Options are public, so the table is kept small by dropping the oldest challenges. Refusing new
// ones instead would let anyone block every passkey login by requesting options in a loop.
const MAX_OPEN_CHALLENGES = 200;

async function storeChallenge(challenge: string) {
  const db = getDb();
  const id = newToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await db.delete(authChallenge).where(lt(authChallenge.expiresAt, now));
  await db.insert(authChallenge).values({ id, challenge, expiresAt });
  await db.execute(sql`
    delete from ${authChallenge} where ${authChallenge.id} in (
      select ${authChallenge.id} from ${authChallenge}
      order by ${authChallenge.expiresAt} desc offset ${MAX_OPEN_CHALLENGES}
    )`);
  (await cookies()).set(CHALLENGE_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: CHALLENGE_PATH,
    expires: expiresAt,
  });
}

/** Single use: the challenge is deleted on read. */
async function consumeChallenge(): Promise<string | null> {
  const store = await cookies();
  const id = store.get(CHALLENGE_COOKIE)?.value;
  store.delete({ name: CHALLENGE_COOKIE, path: CHALLENGE_PATH });
  if (!id) return null;
  const [row] = await getDb().delete(authChallenge).where(eq(authChallenge.id, id)).returning();
  if (!row || row.expiresAt < new Date()) return null;
  return row.challenge;
}

export async function registrationOptions() {
  const { rpID, rpName } = relyingParty();
  const existing = await getDb()
    .select({ id: passkey.id, transports: passkey.transports })
    .from(passkey);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'us',
    userDisplayName: 'Date Planner',
    attestationType: 'none',
    excludeCredentials: existing,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await storeChallenge(options.challenge);
  return options;
}

export async function verifyRegistration(response: RegistrationResponseJSON, deviceName: string) {
  const { rpID, origin } = relyingParty();
  const expectedChallenge = await consumeChallenge();
  if (!expectedChallenge) return false;
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!result.verified) return false;
  const { credential } = result.registrationInfo;
  await getDb()
    .insert(passkey)
    .values({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceName: deviceName.slice(0, 60) || 'Unnamed device',
    });
  return true;
}

export async function authenticationOptions() {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  await storeChallenge(options.challenge);
  return options;
}

/** Returns the id of the passkey used, or null when the response is not valid. */
export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
): Promise<string | null> {
  const { rpID, origin } = relyingParty();
  const expectedChallenge = await consumeChallenge();
  if (!expectedChallenge) return null;
  const db = getDb();
  const [stored] = await db.select().from(passkey).where(eq(passkey.id, response.id)).limit(1);
  if (!stored) return null;
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
      counter: stored.counter,
      transports: stored.transports,
    },
  });
  if (!result.verified) return null;
  await db
    .update(passkey)
    .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkey.id, stored.id));
  return stored.id;
}
