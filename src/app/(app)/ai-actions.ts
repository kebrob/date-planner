'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { IdeasGenerationError } from '@/ai/ideas';
import { TripPlanningError } from '@/ai/trip';
import { requireSession } from '@/auth/session';
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

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

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
  console.error(fallback, error instanceof Error ? error.message : error);
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

export async function undoLastChatTurnAction(): Promise<string | null> {
  await requireSession();
  return undoLastTurn();
}

export async function clearChatAction(): Promise<void> {
  await requireSession();
  await clearHistory();
  revalidatePath('/chat');
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

export async function setTripFavoriteAction(id: string, isFavorite: boolean): Promise<void> {
  await requireSession();
  await setTripFavorite(id, isFavorite);
  revalidatePath('/trips');
  revalidatePath(`/trips/${id}`);
}

export async function deleteTripAction(id: string): Promise<void> {
  await requireSession();
  await deleteTrip(id);
  revalidatePath('/trips');
}
