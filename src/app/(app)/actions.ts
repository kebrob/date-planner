'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getGeocoder } from '@/adapters';
import { requireSession } from '@/auth/session';
import { getDb } from '@/db/client';
import { passkey, settings } from '@/db/schema';
import {
  deletePlan,
  editPlan,
  planAgain,
  PlanNotEditableError,
  PlanNotFoundError,
  savePlan,
  updatePlanMeta,
  type PlanEdit,
  type Window,
} from '@/planner/saved';
import { AreaNotFoundError, generatePlan, type PlanInput } from '@/planner/service';
import { toPlanView, type PlanView } from '@/planner/view';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof AreaNotFoundError) {
    return { ok: false, error: `Couldn't find "${error.query}". Try a town or city name.` };
  }
  if (error instanceof PlanNotFoundError) return { ok: false, error: 'Plan not found.' };
  if (error instanceof PlanNotEditableError) {
    return { ok: false, error: 'This plan can no longer be changed.' };
  }
  console.error(fallback, error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

function revalidatePlans(id?: string) {
  revalidatePath('/');
  revalidatePath('/plans');
  if (id) revalidatePath(`/plans/${id}`);
}

export async function generatePlanAction(input: PlanInput): Promise<Result<PlanView>> {
  await requireSession();
  try {
    const { plan, area } = await generatePlan(input);
    const [home] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
    return { ok: true, data: toPlanView(plan, { lat: home!.homeLat, lng: home!.homeLng }, area) };
  } catch (error) {
    return failure(error, 'Could not create a plan. Check your inputs and try again.');
  }
}

export async function savePlanAction(input: PlanInput, view: PlanView): Promise<Result<string>> {
  await requireSession();
  try {
    const base = { ...input, excludeActivityIds: [] };
    delete base.keep;
    delete base.slots;
    const id = await savePlan(base, view);
    revalidatePlans();
    return { ok: true, data: id };
  } catch (error) {
    return failure(error, 'Could not save the plan.');
  }
}

export async function editPlanAction(id: string, edit: PlanEdit): Promise<Result<number>> {
  await requireSession();
  try {
    const dropped = await editPlan(id, edit);
    revalidatePlans(id);
    return { ok: true, data: dropped };
  } catch (error) {
    return failure(error, 'Could not update the plan.');
  }
}

export async function planAgainAction(id: string, window: Window): Promise<Result<string>> {
  await requireSession();
  try {
    const newId = await planAgain(id, window);
    revalidatePlans();
    return { ok: true, data: newId };
  } catch (error) {
    return failure(error, 'Could not plan this date again.');
  }
}

export async function updatePlanMetaAction(
  id: string,
  changes: { isFavorite?: boolean; note?: string | null },
): Promise<Result<null>> {
  await requireSession();
  try {
    const note =
      changes.note === undefined ? undefined : changes.note?.trim().slice(0, 500) || null;
    await updatePlanMeta(id, { isFavorite: changes.isFavorite, note });
    revalidatePlans(id);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not update the plan.');
  }
}

export async function deletePlanAction(id: string): Promise<Result<null>> {
  await requireSession();
  try {
    await deletePlan(id);
    revalidatePlans();
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not delete the plan.');
  }
}

export async function findTownAction(
  name: string,
): Promise<{ name: string; lat: number; lng: number } | null> {
  await requireSession();
  const query = name.trim().slice(0, 100);
  if (query.length < 2) return null;
  const area = await getGeocoder()
    .find(query)
    .catch(() => null);
  return area ? { name: area.name, lat: area.location.lat, lng: area.location.lng } : null;
}

export async function deletePasskeyAction(id: string): Promise<void> {
  await requireSession();
  await getDb().delete(passkey).where(eq(passkey.id, id));
  revalidatePath('/settings/security');
}
