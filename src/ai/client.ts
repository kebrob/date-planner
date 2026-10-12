import Anthropic from '@anthropic-ai/sdk';
import { getLimits } from '@/config/limits';
import type { CreateMessage } from './tool-loop';

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  client ??= new Anthropic({
    timeout: getLimits().ai.requestTimeoutMs,
    // Bounded retries; a retry storm against a paid API is exactly what the guard must prevent.
    maxRetries: 2,
  });
  return client;
}

export const MODEL = 'claude-sonnet-5-5';

// Not worth starting a call with less time left than this.
const MIN_CALL_MS = 10_000;

/** No time left before the function's time limit to start another call. */
export class AiTimeUpError extends Error {}

/**
 * Request options so a call, retries included, ends by `deadline` (epoch ms). The SDK retries
 * timed-out requests, which would otherwise outlast the function's time limit; the platform would
 * then kill the function before the result or the guard settlement is written.
 */
export function assertTimeLeft(deadline: number): void {
  if (deadline - Date.now() < MIN_CALL_MS) throw new AiTimeUpError();
}

export function untilDeadline(deadline: number): Anthropic.RequestOptions {
  assertTimeLeft(deadline);
  const remaining = deadline - Date.now();
  return {
    timeout: Math.min(getLimits().ai.requestTimeoutMs, remaining),
    signal: AbortSignal.timeout(remaining),
  };
}

/** Streamed, so large `max_tokens` values are allowed (the SDK refuses them without streaming). */
export function createMessageUntil(deadline: number): CreateMessage {
  return (params) => getAnthropic().messages.stream(params, untilDeadline(deadline)).finalMessage();
}
