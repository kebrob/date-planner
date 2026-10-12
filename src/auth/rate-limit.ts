export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_IP = 5;
// Single shared account: a global cap also stops brute force distributed over many IPs.
export const MAX_FAILURES_GLOBAL = 20;

export type LoginMethod = 'password' | 'passkey';

export function isLoginBlocked(
  failures: { ip: number; global: number },
  method: LoginMethod,
): boolean {
  if (failures.ip >= MAX_FAILURES_PER_IP) return true;
  // Passkeys cannot be guessed; a global cap on them would only let anyone lock the owners out.
  return method === 'password' && failures.global >= MAX_FAILURES_GLOBAL;
}
