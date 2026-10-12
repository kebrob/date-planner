import { describe, expect, it } from 'vitest';
import { errorSummary } from './result';

describe('errorSummary', () => {
  it('leaves out messages, which may contain query parameters', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      name: 'DatabaseError',
      code: '23505',
    });
    const error = new Error('Failed query: insert …\nparams: 47.85,12.12,secret note', { cause });
    expect(errorSummary(error)).toBe('Error ← DatabaseError (23505)');
  });

  it('keeps HTTP status codes and names non-errors by type only', () => {
    const apiError = Object.assign(new Error('Overloaded'), { name: 'APIError', status: 529 });
    expect(errorSummary(apiError)).toBe('APIError (529)');
    expect(errorSummary({ password: 'x' })).toBe('object');
  });
});
