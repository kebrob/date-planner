import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { CostGuard, GuardDeniedError } from '@/guard/guard';
import { MemoryUsageStore } from '@/guard/memory-store';
import type { GuardLimits } from '@/guard/types';
import { runToolLoop, type ClientTool, type CreateMessage } from './tool-loop';

const limits: GuardLimits = {
  providers: {
    anthropic: { dailyCostUsd: 100, monthlyCostUsd: 100, dailyRequests: 1000 },
    google_places: { dailyRequests: 25 },
  },
  callsPerMinute: 1000,
  circuitBreaker: { failureThreshold: 5, cooldownMs: 600_000 },
};

function message(
  stop_reason: Anthropic.StopReason,
  content: Anthropic.ContentBlock[],
  webSearches = 0,
  inputTokens = 1000,
): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_reason,
    stop_sequence: null,
    content,
    usage: {
      input_tokens: inputTokens,
      output_tokens: 200,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: webSearches ? { web_search_requests: webSearches } : null,
    },
  } as unknown as Anthropic.Message;
}

const toolUse = (name = 'get_weather', id = 'tu_1') =>
  ({ type: 'tool_use', id, name, input: {} }) as unknown as Anthropic.ContentBlock;
const text = (t: string) =>
  ({ type: 'text', text: t, citations: null }) as unknown as Anthropic.ContentBlock;

const weatherTool: ClientTool = {
  definition: {
    name: 'get_weather',
    description: 'Weather',
    input_schema: { type: 'object', properties: {} },
  },
  execute: vi.fn(async () => 'sunny'),
};

function options(
  createMessage: CreateMessage,
  overrides: Partial<Parameters<typeof runToolLoop>[0]> = {},
) {
  return {
    createMessage,
    guard: new CostGuard({ store: new MemoryUsageStore(), limits }),
    model: 'claude-sonnet-5-5',
    maxTokens: 4000,
    system: 'test',
    messages: [{ role: 'user' as const, content: 'Plan a date' }],
    tools: [weatherTool],
    maxIterations: 8,
    maxWebSearches: 3,
    ...overrides,
  };
}

describe('runToolLoop', () => {
  it('stops after maxIterations when the model requests tools forever', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('tool_use', [toolUse()]));
    const result = await runToolLoop(options(createMessage));
    expect(result.status).toBe('iteration_limit');
    expect(createMessage).toHaveBeenCalledTimes(8);
  });

  it('stops after maxIterations when the server keeps pausing the turn', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('pause_turn', []));
    const result = await runToolLoop(options(createMessage, { maxIterations: 3 }));
    expect(result.status).toBe('iteration_limit');
    expect(createMessage).toHaveBeenCalledTimes(3);
  });

  it('runs client tools and returns the final answer', async () => {
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(message('tool_use', [toolUse()]))
      .mockResolvedValueOnce(message('end_turn', [text('Go hiking')]));
    const result = await runToolLoop(options(createMessage));
    expect(result).toMatchObject({ status: 'done', text: 'Go hiking', iterations: 2 });
    const secondCall = createMessage.mock.calls[1]![0];
    expect(secondCall.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'sunny' }],
    });
  });

  it('sets max_tokens on every request', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('tool_use', [toolUse()]));
    await runToolLoop(options(createMessage, { maxIterations: 3 }));
    for (const [params] of createMessage.mock.calls) expect(params.max_tokens).toBe(4000);
  });

  it('caps web searches across all iterations, then removes the search tool', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('tool_use', [toolUse()], 2));
    const result = await runToolLoop(
      options(createMessage, { maxIterations: 4, maxWebSearches: 3 }),
    );

    const searchTool = (i: number) =>
      createMessage.mock.calls[i]![0].tools?.find((t) => 'name' in t && t.name === 'web_search') as
        { max_uses?: number } | undefined;
    expect(searchTool(0)?.max_uses).toBe(3);
    expect(searchTool(1)?.max_uses).toBe(1);
    expect(searchTool(2)).toBeUndefined();
    expect(searchTool(3)).toBeUndefined();
    expect(result.webSearches).toBe(8); // reported by the mock, not limited by it
  });

  it('omits web search entirely when maxWebSearches is 0', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('end_turn', [text('ok')]));
    await runToolLoop(options(createMessage, { maxWebSearches: 0 }));
    const tools = createMessage.mock.calls[0]![0].tools ?? [];
    expect(tools.some((t) => 'name' in t && t.name === 'web_search')).toBe(false);
  });

  it('returns tool errors to the model instead of throwing', async () => {
    const failingTool: ClientTool = {
      definition: { ...weatherTool.definition },
      execute: async () => {
        throw new Error('weather down');
      },
    };
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(message('tool_use', [toolUse(), toolUse('unknown_tool', 'tu_2')]))
      .mockResolvedValueOnce(message('end_turn', [text('done')]));
    await runToolLoop(options(createMessage, { tools: [failingTool] }));
    expect(createMessage.mock.calls[1]![0].messages.at(-1)).toMatchObject({
      content: [
        { tool_use_id: 'tu_1', content: 'weather down', is_error: true },
        { tool_use_id: 'tu_2', is_error: true },
      ],
    });
  });

  it('stops before calling the API once the budget is exhausted', async () => {
    const tight: GuardLimits = {
      ...limits,
      providers: {
        ...limits.providers,
        anthropic: { dailyCostUsd: 0.15, monthlyCostUsd: 10, dailyRequests: 100 },
      },
    };
    const guard = new CostGuard({ store: new MemoryUsageStore(), limits: tight });
    // Each call really costs 50k input tokens ≈ $0.10, so the second reservation no longer fits.
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('tool_use', [toolUse()], 0, 50_000),
    );
    const result = await runToolLoop(options(createMessage, { guard }));
    expect(result.status).toBe('interrupted');
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['refusal', 'max_tokens'] as const)('ends the loop on %s', async (stop) => {
    const createMessage = vi.fn<CreateMessage>(async () => message(stop, [text('partial')]));
    const result = await runToolLoop(options(createMessage));
    expect(result.status).toBe(stop);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });
});

describe('runToolLoop interruptions', () => {
  it('keeps earlier rounds when a later call is denied by the guard', async () => {
    let calls = 0;
    const guard = new CostGuard({ store: new MemoryUsageStore(), limits });
    const run = guard.run.bind(guard);
    vi.spyOn(guard, 'run').mockImplementation((provider, estimate, call) =>
      ++calls > 1
        ? Promise.reject(new GuardDeniedError('anthropic', 'rate_limit'))
        : run(provider, estimate, call),
    );
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('tool_use', [text('Checking the weather'), toolUse()]),
    );
    const result = await runToolLoop(options(createMessage, { guard }));
    expect(result.status).toBe('interrupted');
    expect(result.text).toBe('Checking the weather');
    expect(weatherTool.execute).toHaveBeenCalled();
  });

  it('still fails when the very first call is denied', async () => {
    const guard = new CostGuard({
      store: new MemoryUsageStore(),
      limits,
      enabled: { anthropic: false },
    });
    const createMessage = vi.fn<CreateMessage>();
    await expect(runToolLoop(options(createMessage, { guard }))).rejects.toThrow(GuardDeniedError);
  });
});
