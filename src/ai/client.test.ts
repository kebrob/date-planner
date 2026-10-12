import { describe, expect, it } from 'vitest';
import { AiTimeUpError, untilDeadline } from './client';

describe('untilDeadline', () => {
  it('limits a call, retries included, to the time left', () => {
    const options = untilDeadline(Date.now() + 30_000);
    expect(options.timeout).toBeLessThanOrEqual(30_000);
    expect(options.timeout).toBeGreaterThan(29_000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the configured request timeout when more time is left', () => {
    expect(untilDeadline(Date.now() + 600_000).timeout).toBe(90_000);
  });

  it('refuses to start a call shortly before the deadline', () => {
    expect(() => untilDeadline(Date.now() + 5_000)).toThrow(AiTimeUpError);
  });
});
