import Anthropic from '@anthropic-ai/sdk';
import { getLimits } from '@/config/limits';

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
