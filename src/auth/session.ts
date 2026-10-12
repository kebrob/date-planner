import { createHash } from 'node:crypto';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb, type Db } from '@/db/client';
import { loginAttempt, session } from '@/db/schema';
import { isLoginBlocked, LOGIN_WINDOW_MS, type LoginMethod } from './rate-limit';
import { hashToken, newToken } from './tokens';

export const SESSION_COOKIE = 'dp_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export async function createSession(): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb()
    .insert(session)
    .values({ tokenHash: hashToken(token), expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function hasValidSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const [row] = await getDb()
    .select({ tokenHash: session.tokenHash })
    .from(session)
    .where(and(eq(session.tokenHash, hashToken(token)), gt(session.expiresAt, new Date())))
    .limit(1);
  return Boolean(row);
}

/** Use at the start of every protected page, server action and route handler. */
export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) redirect('/login');
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
