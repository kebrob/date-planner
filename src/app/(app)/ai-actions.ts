'use server';

import { revalidatePath } from 'next/cache';
import { z, ZodError } from 'zod';
import { IdeasGenerationError } from '@/ai/ideas';
import { TripPlanningError } from '@/ai/trip';
import { requireSession } from '@/auth/session';
import { logError, type Result } from '@/lib/result';
import {
  ChatDisabledError,
  clearHistory,
  sendChatMessage,
  undoLastTurn,
  type ChatReply,
} from '@/chat/service';
import { GuardDeniedError } from '@/guard';
import { AreaNotFoundError } from '@/planner/service';
import { createTrip, deleteTrip, setTripFavorite, TripsDisabledError } from '@/trips/service';

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? fallback };
  }
  if (error instanceof GuardDeniedError) {
    return {
      ok: false,
      error:
        error.reason === 'disabled'
          ? 'Claude is disabled (AI_ENABLED=false).'
          : `Claude limit reached (${error.reason.replace('_', ' ')}). Try again later.`,
    };
  }
  if (error instanceof ChatDisabledError || error instanceof TripsDisabledError) {
    return { ok: false, error: 'Claude is disabled (AI_ENABLED=false).' };
  }
  if (error instanceof AreaNotFoundError) {
    return { ok: false, error: `Couldn't find "${error.query}".` };
  }
  if (error instanceof TripPlanningError || error instanceof IdeasGenerationError) {
    return { ok: false, error: error.message };
  }
  logError(fallback, error);
  return { ok: false, error: fallback };
}

export async function chatAction(message: string): Promise<Result<ChatReply>> {
  await requireSession();
  try {
    return { ok: true, data: await sendChatMessage(message) };
  } catch (error) {
    return failure(error, 'Claude could not answer right now.');
  }
}

export async function undoLastChatTurnAction(): Promise<Result<string | null>> {
  await requireSession();
  try {
    return { ok: true, data: await undoLastTurn() };
  } catch (error) {
    return failure(error, 'Could not undo the last question.');
  }
}

export async function clearChatAction(): Promise<Result<null>> {
  await requireSession();
  try {
    await clearHistory();
    revalidatePath('/chat');
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not clear the conversation.');
  }
}

export async function createTripAction(input: unknown): Promise<Result<string>> {
  await requireSession();
  try {
    const id = await createTrip(input);
    revalidatePath('/trips');
    return { ok: true, data: id };
  } catch (error) {
    return failure(error, 'Could not plan the trip.');
  }
}

const tripId = z.string().uuid();

export async function setTripFavoriteAction(
  id: string,
  isFavorite: boolean,
): Promise<Result<null>> {
  await requireSession();
  try {
    await setTripFavorite(tripId.parse(id), z.boolean().parse(isFavorite));
    revalidatePath('/trips');
    revalidatePath(`/trips/${id}`);
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not update the trip.');
  }
}

export async function deleteTripAction(id: string): Promise<Result<null>> {
  await requireSession();
  try {
    await deleteTrip(tripId.parse(id));
    revalidatePath('/trips');
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, 'Could not delete the trip.');
  }
}
