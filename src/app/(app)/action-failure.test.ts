import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GuardDeniedError } from '@/guard/guard';
import { AreaNotFoundError } from '@/planner/service';
import { failure } from './action-failure';

describe('failure', () => {
  it('names the field of an invalid input', () => {
    const error = z.object({ title: z.string().min(2) }).safeParse({ title: 'x' }).error;
    expect(failure(error, 'fallback').error).toMatch(/^title: /);
  });

  it('explains known errors in user terms', () => {
    expect(failure(new GuardDeniedError('anthropic', 'rate_limit'), 'x').error).toMatch(/wait/);
    expect(failure(new AreaNotFoundError('Atlantis'), 'x').error).toContain('"Atlantis"');
  });

  it('logs unexpected errors and shows the fallback', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(failure(new Error('Failed query: secret'), 'Could not save.')).toEqual({
      ok: false,
      error: 'Could not save.',
    });
    expect(log).toHaveBeenCalledWith('Could not save.', 'Error');
  });
});
