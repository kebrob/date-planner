'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import {
  AdminInputError,
  deleteActivity,
  deleteRoutine,
  exportIdeasPrompt,
  generateIdeasWithClaude,
  importIdeas,
  saveActivity,
  saveRoutine,
  saveSettings,
  setActivityStatus,
} from '@/admin/service';
import { IdeasGenerationError, IdeasImportError } from '@/ai/ideas';
import { requireSession } from '@/auth/session';
import { GuardDeniedError } from '@/guard';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const GUARD_MESSAGES: Record<GuardDeniedError['reason'], string> = {
  daily_budget: 'Daily Claude budget reached – try again tomorrow or use the prompt export.',
  monthly_budget: 'Monthly Claude budget reached – use the prompt export instead.',
  daily_requests: 'Daily request limit reached – try again tomorrow.',
  rate_limit: 'Too many requests right now – wait a minute.',
  circuit_open: 'Claude is failing repeatedly – paused for a few minutes.',
  store_unavailable: 'Usage tracking unavailable, so the request was blocked for safety.',
  disabled: 'Claude is disabled (AI_ENABLED=false). Use the prompt export instead.',
};

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return {
      ok: false,
      error: issue ? `${issue.path.join('.') || 'Input'}: ${issue.message}` : fallback,
    };
  }
  if (error instanceof GuardDeniedError) return { ok: false, error: GUARD_MESSAGES[error.reason] };
  if (
    error instanceof AdminInputError ||
    error instanceof IdeasImportError ||
    error instanceof IdeasGenerationError
  ) {
    return { ok: false, error: error.message };
  }
  console.error(fallback, error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

async function guarded<T>(
  fallback: string,
  fn: () => Promise<T>,
  paths: string[],
): Promise<Result<T>> {
  await requireSession();
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return failure(error, fallback);
  }
}

export const saveSettingsAction = async (input: unknown) =>
  guarded('Could not save settings.', () => saveSettings(input), ['/admin', '/']);

export const saveRoutineAction = async (id: string | null, input: unknown) =>
  guarded('Could not save routine.', () => saveRoutine(id, input), ['/admin']);

export const deleteRoutineAction = async (id: string) =>
  guarded('Could not delete routine.', () => deleteRoutine(id), ['/admin']);

export const saveActivityAction = async (id: string | null, input: unknown) =>
  guarded('Could not save activity.', () => saveActivity(id, input), ['/admin/activities']);

export const setActivityStatusAction = async (id: string, status: 'draft' | 'active' | 'blocked') =>
  guarded('Could not update activity.', () => setActivityStatus(id, status), ['/admin/activities']);

export const deleteActivityAction = async (id: string) =>
  guarded('Could not delete activity.', () => deleteActivity(id), ['/admin/activities']);

export const generateIdeasAction = async (input: { count: number; focus?: string }) =>
  guarded('Could not generate ideas.', () => generateIdeasWithClaude(input), [
    '/admin/activities',
    '/admin',
  ]);

export const importIdeasAction = async (text: string) =>
  guarded('Could not import ideas.', () => importIdeas(text), ['/admin/activities']);

export const exportPromptAction = async (focus?: string) =>
  guarded('Could not build the prompt.', () => exportIdeasPrompt(10, focus), []);
