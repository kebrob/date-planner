import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { isLoginBlocked, MAX_FAILURES_GLOBAL, MAX_FAILURES_PER_IP } from './rate-limit';
import { hashToken, newToken } from './tokens';

describe('password', () => {
  it('verifies the correct password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });

  it('uses a random salt per hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it.each(['', 'plain', 'bcrypt$1$2$3$a$b', 'scrypt$$$$$'])(
    'rejects malformed hash %j',
    async (stored) => {
      await expect(verifyPassword('x', stored)).resolves.toBe(false);
    },
  );
});

describe('tokens', () => {
  it('creates unique tokens and stable hashes that differ from the token', () => {
    const a = newToken();
    expect(a).not.toBe(newToken());
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });
});

describe('isLoginBlocked', () => {
  it('blocks after too many failures per IP or globally', () => {
    expect(isLoginBlocked({ ip: MAX_FAILURES_PER_IP - 1, global: 0 })).toBe(false);
    expect(isLoginBlocked({ ip: MAX_FAILURES_PER_IP, global: 0 })).toBe(true);
    expect(isLoginBlocked({ ip: 0, global: MAX_FAILURES_GLOBAL })).toBe(true);
  });
});
