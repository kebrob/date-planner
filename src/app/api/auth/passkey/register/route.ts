import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { signInAgain } from '@/auth/responses';
import { hasFreshSession, hasValidSession } from '@/auth/session';
import { verifyRegistration } from '@/auth/webauthn';

const body = z.object({ deviceName: z.string().max(60), response: z.unknown() });

export async function POST(request: Request) {
  if (!(await hasValidSession())) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await hasFreshSession())) return signInAgain();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });
  const ok = await verifyRegistration(
    parsed.data.response as RegistrationResponseJSON,
    parsed.data.deviceName,
  ).catch(() => false);
  if (!ok) return Response.json({ error: 'Passkey registration failed' }, { status: 400 });
  return Response.json({ ok: true });
}
