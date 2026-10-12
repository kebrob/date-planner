'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import type { Result } from '@/lib/result';
import { clearHistory, sendChatMessage, undoLastTurn, type ChatReply } from '@/chat/service';
import { createTrip, deleteTrip, setTripFavorite } from '@/trips/service';
import { failure } from './action-failure';

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
