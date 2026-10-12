import { ZodError } from 'zod';
import { AdminInputError } from '@/admin/service';
import { IdeasGenerationError, IdeasImportError } from '@/ai/ideas';
import { TripPlanningError } from '@/ai/trip';
import { ChatDisabledError } from '@/chat/service';
import { GuardDeniedError } from '@/guard/guard';
import { logError } from '@/lib/result';
import { PlanNotEditableError, StopNotAddedError } from '@/planner/edit';
import { PlanNotFoundError } from '@/planner/saved';
import { AreaNotFoundError } from '@/planner/service';
import { PlanNotRatableError } from '@/ratings/service';
import { TripsDisabledError } from '@/trips/service';

const AI_DISABLED = 'Claude is disabled (AI_ENABLED=false).';

const GUARD_MESSAGES: Record<GuardDeniedError['reason'], string> = {
  daily_budget: 'Daily Claude budget reached – try again tomorrow.',
  monthly_budget: 'Monthly Claude budget reached.',
  daily_requests: 'Daily request limit reached – try again tomorrow.',
  rate_limit: 'Too many requests right now – wait a minute.',
  circuit_open: 'Claude is failing repeatedly – paused for a few minutes.',
  store_unavailable: 'Usage tracking unavailable, so the request was blocked for safety.',
  disabled: AI_DISABLED,
};

// Errors whose message is written for the user.
const USER_FACING = [AdminInputError, IdeasImportError, IdeasGenerationError, TripPlanningError];

function message(error: unknown): string | null {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (!issue) return null;
    const field = issue.path.join('.');
    return field ? `${field}: ${issue.message}` : issue.message;
  }
  if (error instanceof GuardDeniedError) return GUARD_MESSAGES[error.reason];
  if (error instanceof ChatDisabledError || error instanceof TripsDisabledError) return AI_DISABLED;
  if (error instanceof AreaNotFoundError) {
    return `Couldn't find "${error.query}". Try a town or city name.`;
  }
  if (error instanceof PlanNotFoundError) return 'Plan not found.';
  if (error instanceof PlanNotEditableError) return 'This plan can no longer be changed.';
  if (error instanceof StopNotAddedError) return 'Nothing fits into that gap. Try another idea.';
  if (error instanceof PlanNotRatableError) return 'This date cannot be rated (yet).';
  if (USER_FACING.some((type) => error instanceof type)) return (error as Error).message;
  return null;
}

/** Result for a failed server action; unexpected errors are logged and get `fallback`. */
export function failure(error: unknown, fallback: string): { ok: false; error: string } {
  const text = message(error);
  if (text === null) logError(fallback, error);
  return { ok: false, error: text ?? fallback };
}
