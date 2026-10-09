import { createHash } from 'node:crypto';
import { and, eq, gt, gte } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { loginAttempt, session } from '@/db/schema';
import { isLoginBlocked, LOGIN_WINDOW_MS } from './rate-limit';
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

async function clientIpHash(): Promise<string> {
  const h = await headers();
  const ip = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return createHash('sha256').update(ip).digest('base64url');
}

export async function loginBlocked(): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const ipHash = await clientIpHash();
  const failures = await getDb()
    .select({ ipHash: loginAttempt.ipHash })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.success, false), gte(loginAttempt.createdAt, since)));
  return isLoginBlocked({
    ip: failures.filter((f) => f.ipHash === ipHash).length,
    global: failures.length,
  });
}

export async function recordLoginAttempt(success: boolean): Promise<void> {
  await getDb()
    .insert(loginAttempt)
    .values({ ipHash: await clientIpHash(), success });
}
