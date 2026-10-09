export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES_PER_IP = 5;
// Single shared account: a global cap also stops brute force distributed over many IPs.
export const MAX_FAILURES_GLOBAL = 20;

export function isLoginBlocked(failures: { ip: number; global: number }): boolean {
  return failures.ip >= MAX_FAILURES_PER_IP || failures.global >= MAX_FAILURES_GLOBAL;
}
