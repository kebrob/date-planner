'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/auth/session';
import { getDb } from '@/db/client';
import { passkey, settings } from '@/db/schema';
import { acceptPlan, AreaNotFoundError, generatePlan, type PlanInput } from '@/planner/service';
import { toPlanView, type PlanView } from '@/planner/view';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function generatePlanAction(input: PlanInput): Promise<Result<PlanView>> {
  await requireSession();
  try {
    const { plan, area } = await generatePlan(input);
    const [home] = await getDb().select().from(settings).where(eq(settings.id, 1)).limit(1);
    return { ok: true, data: toPlanView(plan, { lat: home!.homeLat, lng: home!.homeLng }, area) };
  } catch (error) {
    if (error instanceof AreaNotFoundError) {
      return { ok: false, error: `Couldn't find "${error.query}". Try a town or city name.` };
    }
    console.error('generatePlan failed', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not create a plan. Check your inputs and try again.' };
  }
}

export async function acceptPlanAction(input: PlanInput, view: PlanView): Promise<Result<string>> {
  await requireSession();
  try {
    const id = await acceptPlan({
      start: view.items[0]!.start,
      end: view.items.at(-1)!.end,
      parameters: input as Record<string, unknown>,
      weather: view.weather,
      totalCostEur: view.totalCostEur,
      items: view.items.map((i) => ({
        activityId: i.activityId,
        title: i.title,
        start: i.start,
        end: i.end,
        costEur: i.costEur,
        place: i.place,
        travel: i.travelBefore,
      })),
    });
    revalidatePath('/plans');
    return { ok: true, data: id };
  } catch (error) {
    console.error('acceptPlan failed', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not save the plan.' };
  }
}

export async function deletePasskeyAction(id: string): Promise<void> {
  await requireSession();
  await getDb().delete(passkey).where(eq(passkey.id, id));
  revalidatePath('/settings/security');
}
