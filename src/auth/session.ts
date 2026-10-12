import { createHash } from 'node:crypto';
import { and, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb, type Db } from '@/db/client';
import { loginAttempt, session } from '@/db/schema';
import { SESSION_COOKIE } from './cookie';
import { isLoginBlocked, LOGIN_WINDOW_MS, type LoginMethod } from './rate-limit';
import { hashToken, newToken } from './tokens';

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
// Managing passkeys needs a recent sign-in, so a stolen session cookie cannot add its own passkey.
const FRESH_SESSION_MS = 10 * 60_000;
// Login attempts only matter within the rate-limit window; older ones are deleted.
const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60_000;

/** `passkeyId`: the passkey used to sign in, so removing it ends this session. */
export async function createSession(passkeyId: string | null = null): Promise<void> {
  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS);
  const db = getDb();
  await db.insert(session).values({ tokenHash: hashToken(token), passkeyId, expiresAt });
  await db.delete(session).where(lt(session.expiresAt, new Date(now)));
  await db
    .delete(loginAttempt)
    .where(lt(loginAttempt.createdAt, new Date(now - LOGIN_ATTEMPT_RETENTION_MS)));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

async function currentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await getDb()
    .select({ createdAt: session.createdAt })
    .from(session)
    .where(and(eq(session.tokenHash, hashToken(token)), gt(session.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function hasValidSession(): Promise<boolean> {
  return Boolean(await currentSession());
}

/** Use at the start of every protected page, server action and route handler. */
export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) redirect('/login');
}

/** Signed in within the last few minutes. */
export async function hasFreshSession(): Promise<boolean> {
  const row = await currentSession();
  return Boolean(row && Date.now() - row.createdAt.getTime() < FRESH_SESSION_MS);
}

/** Signs out every device, including this one. */
export async function destroyAllSessions(): Promise<void> {
  await getDb().delete(session);
  (await cookies()).delete(SESSION_COOKIE);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token)
    await getDb()
      .delete(session)
      .where(eq(session.tokenHash, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

// Arbitrary constant key; serializes the check-and-count of login attempts.
const LOGIN_LOCK_KEY = 4_711_002;

async function clientIpHash(): Promise<string> {
  const h = await headers();
  // Only Vercel's edge sets these headers reliably; elsewhere a client could change them on every
  // request to reset its own counter, so all requests share one bucket.
  const ip = process.env.VERCEL
    ? (h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim())
    : null;
  return createHash('sha256')
    .update(ip ?? 'unknown')
    .digest('base64url');
}

async function failureCounts(db: Pick<Db, 'select'>, ipHash: string) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const failures = await db
    .select({ ipHash: loginAttempt.ipHash })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.success, false), gte(loginAttempt.createdAt, since)));
  return { ip: failures.filter((f) => f.ipHash === ipHash).length, global: failures.length };
}

/** Read-only check, e.g. before handing out a passkey challenge. */
export async function loginBlocked(method: LoginMethod): Promise<boolean> {
  return isLoginBlocked(await failureCounts(getDb(), await clientIpHash()), method);
}

/**
 * Starts a login attempt and counts it as failed right away, so parallel requests cannot all pass
 * the check before any failure is stored. Returns null when blocked, else the attempt to confirm
 * with `confirmLoginAttempt` on success.
 */
export async function beginLoginAttempt(method: LoginMethod): Promise<string | null> {
  const ipHash = await clientIpHash();
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOGIN_LOCK_KEY})`);
    if (isLoginBlocked(await failureCounts(tx, ipHash), method)) return null;
    const [attempt] = await tx
      .insert(loginAttempt)
      .values({ ipHash, success: false })
      .returning({ id: loginAttempt.id });
    return attempt!.id;
  });
}

export async function confirmLoginAttempt(id: string): Promise<void> {
  await getDb().update(loginAttempt).set({ success: true }).where(eq(loginAttempt.id, id));
}
