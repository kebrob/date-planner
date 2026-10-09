import type Anthropic from '@anthropic-ai/sdk';

type Rates = { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number };

// USD per million tokens, Anthropic list prices as of 2026-10 (see docs/betrieb/kostenlimits.md).
const RATES: Record<string, Rates> = {
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;
export const WEB_SEARCH_USD = 0.01;
// Upper bound for tokens one search result set adds to the context.
const TOKENS_PER_WEB_SEARCH = 10_000;
const CHARS_PER_TOKEN = 3;

function ratesFor(model: string): Rates {
  const rates = RATES[model];
  if (!rates) throw new Error(`No pricing configured for model ${model}`);
  return rates;
}

export function actualCostUsd(model: string, usage: Anthropic.Usage): number {
  const r = ratesFor(model);
  const tokens =
    usage.input_tokens * r.inputPerMTok +
    (usage.cache_creation_input_tokens ?? 0) * r.inputPerMTok * CACHE_WRITE_MULTIPLIER +
    (usage.cache_read_input_tokens ?? 0) * r.cacheReadPerMTok +
    usage.output_tokens * r.outputPerMTok;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return tokens / 1_000_000 + searches * WEB_SEARCH_USD;
}

/** Worst-case cost of a request, used to reserve budget before the call. */
export function estimateMaxCostUsd(
  params: { model: string; max_tokens: number },
  serializedRequestLength: number,
  maxWebSearches: number,
): number {
  const r = ratesFor(params.model);
  const inputTokens =
    Math.ceil(serializedRequestLength / CHARS_PER_TOKEN) + maxWebSearches * TOKENS_PER_WEB_SEARCH;
  return (
    (inputTokens * r.inputPerMTok + params.max_tokens * r.outputPerMTok) / 1_000_000 +
    maxWebSearches * WEB_SEARCH_USD
  );
}
