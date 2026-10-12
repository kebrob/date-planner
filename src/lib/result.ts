export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Error class and code only: messages of failed queries include their parameters (notes, home). */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const codeOf = (e: unknown) => {
    const { code, status } = (e ?? {}) as { code?: unknown; status?: unknown };
    return typeof code === 'string' ? code : typeof status === 'number' ? String(status) : null;
  };
  const code = codeOf(error) ?? codeOf(error.cause);
  const cause = error.cause instanceof Error ? ` ← ${error.cause.name}` : '';
  return `${error.name}${cause}${code ? ` (${code})` : ''}`;
}

export function logError(context: string, error: unknown): void {
  console.error(context, errorSummary(error));
}
