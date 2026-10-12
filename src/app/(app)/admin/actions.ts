'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteActivity,
  deleteRoutine,
  exportIdeasPrompt,
  generateIdeasWithClaude,
  importIdeas,
  saveActivity,
  saveHomePin,
  saveRoutine,
  saveSettings,
  setActivityStatus,
} from '@/admin/service';
import { requireSession } from '@/auth/session';
import type { Result } from '@/lib/result';
import { failure } from '../action-failure';

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

export const saveHomePinAction = async (pin: { lat: number; lng: number } | null) =>
  guarded('Could not save the home pin.', () => saveHomePin(pin), ['/admin']);

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
