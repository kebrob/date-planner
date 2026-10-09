import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { actualCostUsd, estimateMaxCostUsd } from './pricing';

describe('pricing', () => {
  it('computes Sonnet 5.5 cost including cache and web search', () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1_000_000,
      server_tool_use: { web_search_requests: 3 },
    } as unknown as Anthropic.Usage;
    // 2.00 input + 1.00 output + 0.20 cache read + 0.03 search
    expect(actualCostUsd('claude-sonnet-5-5', usage)).toBeCloseTo(3.23, 5);
  });

  it('estimates the worst case from max_tokens and allowed searches', () => {
    const estimate = estimateMaxCostUsd({ model: 'claude-sonnet-5-5', max_tokens: 4000 }, 3000, 3);
    // input: 1000 + 30000 tokens × $2/M = 0.062, output: 4000 × $10/M = 0.04, search: 0.03
    expect(estimate).toBeCloseTo(0.132, 5);
  });

  it('refuses unknown models instead of assuming zero cost', () => {
    expect(() => estimateMaxCostUsd({ model: 'unknown', max_tokens: 1 }, 1, 0)).toThrow();
  });
});
