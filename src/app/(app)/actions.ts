'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getGeocoder } from '@/adapters';
import { SIGN_IN_AGAIN } from '@/auth/responses';
import { destroyAllSessions, hasFreshSession, requireSession } from '@/auth/session';
import { logError, type Result } from '@/lib/result';
import { getDb } from '@/db/client';
import { passkey, settings } from '@/db/schema';
import {
  deletePlan,
  editPlan,
  planAgain,
  PlanNotEditableError,
  PlanNotFoundError,
  savePlan,
  StopNotAddedError,
  updatePlanMeta,
  type PlanEdit,
  type Window,
} from '@/planner/saved';
import {
  AreaNotFoundError,
  generatePlan,
  homePoint,
  savedInput,
  type PlanInput,
} from '@/planner/service';
import { toPlanView, type PlanView } from '@/planner/view';
import {
  addIdea,
  listIdeaOptions,
  searchPlaces,
  type IdeaOption,
  type newIdeaSchema,
  type placeSearchSchema,
} from '@/planner/chosen';
import type { Place } from '@/ports/places';
import { nextTrain, type LiveTrain } from '@/rail/live';
import {
  dismissRatingPrompt,
  PlanNotRatableError,
  rateDate,
  rateItem,
  ratingSchema,
  setNotHappened,
  type Rating,
} from '@/ratings/service';

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof AreaNotFoundError) {
    return { ok: false, error: `Couldn't find "${error.query}". Try a town or city name.` };
  }
  if (error instanceof PlanNotFoundError) return { ok: false, error: 'Plan not found.' };
  if (error instanceof PlanNotEditableError) {
    return { ok: false, error: 'This plan can no longer be changed.' };
  }
  if (error instanceof StopNotAddedError) {
    return { ok: false, error: 'Nothing fits into that gap. Try another idea.' };
  }
  if (error instanceof PlanNotRatableError) {
    return { ok: false, error: 'This date cannot be rated (yet).' };
  }
  logError(fallback, error);
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
    return { ok: true, data: toPlanView(plan, homePoint(home!), area) };
  } catch (error) {
    return failure(error, 'Could not create a plan. Check your inputs and try again.');
  }
}

export async function savePlanAction(input: PlanInput, view: PlanView): Promise<Result<string>> {
  await requireSession();
  try {
    const id = await savePlan(savedInput(input), view);
    revalidatePlans();
    return { ok: true, data: id };
  } catch (error) {
    return failure(error, 'Could not save the plan.');
  }
}

export async function editPlanAction(id: string, edit: PlanEdit): Promise<Result<string[]>> {
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
    await updatePlanMeta(id, {
      isFavorite: z.boolean().optional().parse(changes.isFavorite),
      note,
    });
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

/** Sessions signed in with the passkey end with it (cascade). */
export async function deletePasskeyAction(id: string): Promise<Result<null>> {
  await requireSession();
  if (!(await hasFreshSession())) return { ok: false, error: SIGN_IN_AGAIN };
  try {
    await getDb()
      .delete(passkey)
      .where(eq(passkey.id, z.string().min(1).max(1000).parse(id)));
    revalidatePath('/settings/security');
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not remove the passkey.');
  }
}

export async function signOutEverywhereAction(): Promise<void> {
  await requireSession();
  await destroyAllSessions();
  redirect('/login');
}

/** Polled by the live train card on the home screen. */
export async function liveTrainAction(): Promise<LiveTrain | null> {
  await requireSession();
  return nextTrain().catch(() => null);
}

export async function rateDateAction(id: string, rating: Rating): Promise<Result<null>> {
  await requireSession();
  try {
    await rateDate(id, ratingSchema.parse(rating));
    revalidatePlans(id);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not save the rating.');
  }
}

export async function rateItemAction(
  id: string,
  position: number,
  rating: Rating,
  placeBlamed: boolean,
): Promise<Result<{ suggestBlock: boolean; activityId: string | null }>> {
  await requireSession();
  try {
    const result = await rateItem(
      id,
      z.number().int().min(0).max(10).parse(position),
      ratingSchema.parse(rating),
      z.boolean().parse(placeBlamed),
    );
    revalidatePlans(id);
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, 'Could not save the rating.');
  }
}

export async function setNotHappenedAction(
  id: string,
  notHappened: boolean,
): Promise<Result<null>> {
  await requireSession();
  try {
    await setNotHappened(id, z.boolean().parse(notHappened));
    revalidatePlans(id);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not update the date.');
  }
}

export async function dismissRatingPromptAction(id: string): Promise<Result<null>> {
  await requireSession();
  try {
    await dismissRatingPrompt(id);
    revalidatePath('/');
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not skip the rating.');
  }
}

export async function listIdeaOptionsAction(): Promise<Result<IdeaOption[]>> {
  await requireSession();
  try {
    return { ok: true, data: await listIdeaOptions() };
  } catch (error) {
    return failure(error, 'Could not load your ideas.');
  }
}

/** Paid place search; only called when the user taps "Search Google". */
export async function searchPlacesAction(
  input: z.input<typeof placeSearchSchema>,
): Promise<Result<{ places: Place[]; limitReached: boolean }>> {
  await requireSession();
  try {
    return { ok: true, data: await searchPlaces(input) };
  } catch (error) {
    return failure(error, 'Could not search places.');
  }
}

export async function addIdeaAction(input: z.input<typeof newIdeaSchema>): Promise<Result<string>> {
  await requireSession();
  try {
    const id = await addIdea(input);
    revalidatePath('/admin/activities');
    return { ok: true, data: id };
  } catch (error) {
    return failure(error, 'Could not save the idea.');
  }
}
