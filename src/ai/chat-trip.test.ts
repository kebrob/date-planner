import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { CostGuard } from '@/guard/guard';
import { MemoryUsageStore } from '@/guard/memory-store';
import type { GuardLimits } from '@/guard/types';
import { chatTools, MAX_HISTORY_TURNS, runChat, type ChatToolHandlers } from './chat';
import type { CreateMessage } from './tool-loop';
import { planTrip, tripPrompt, TripPlanningError, type TripPlan } from './trip';

const limits: GuardLimits = {
  providers: {
    anthropic: { dailyCostUsd: 100, monthlyCostUsd: 100, dailyRequests: 1000 },
    google_places: { dailyRequests: 25 },
  },
  callsPerMinute: 1000,
  circuitBreaker: { failureThreshold: 5, cooldownMs: 600_000 },
};
const guard = () => new CostGuard({ store: new MemoryUsageStore(), limits });

function message(stop_reason: Anthropic.StopReason, content: unknown[]): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_reason,
    stop_sequence: null,
    content,
    usage: {
      input_tokens: 500,
      output_tokens: 100,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
    },
  } as unknown as Anthropic.Message;
}
const text = (t: string) => ({ type: 'text', text: t, citations: null });
const toolUse = (name: string, input: unknown, id = 'tu') => ({
  type: 'tool_use',
  id,
  name,
  input,
});

const handlers: ChatToolHandlers = {
  planDate: vi.fn(async () => 'Plan 1: Cinema 18:00–20:30, ~25 €'),
  weather: vi.fn(async () => 'Dry, 12–15 °C'),
  findIdeas: vi.fn(async () => 'Cinema; Bowling'),
  saveIdea: vi.fn(async () => 'Saved as draft'),
  listPlans: vi.fn(async () => 'No upcoming plans'),
};

describe('chat tools', () => {
  it('declares strict schemas where every property is required', () => {
    for (const tool of chatTools(handlers)) {
      const schema = tool.definition.input_schema as unknown as {
        properties: object;
        required: string[];
        additionalProperties: boolean;
      };
      expect(tool.definition.strict).toBe(true);
      expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('validates tool input before calling handlers', async () => {
    const plan = chatTools(handlers).find((t) => t.definition.name === 'plan_date')!;
    await expect(plan.execute({ date: 'tomorrow' })).rejects.toThrow(/Invalid input/);
    expect(handlers.planDate).not.toHaveBeenCalled();
  });
});

describe('tool errors', () => {
  it('never forwards internal error details to the model', async () => {
    const failing = chatTools({
      ...handlers,
      listPlans: async () => {
        throw new Error('relation "date_plan" does not exist at db.internal:5432');
      },
    }).find((t) => t.definition.name === 'list_plans')!;
    const error = await failing.execute({}).catch((e: Error) => e);
    expect(String(error)).not.toContain('date_plan');
    expect(String(error)).toContain('internal error');
  });
});

describe('runChat', () => {
  const deps = (createMessage: CreateMessage) => ({
    createMessage,
    guard: guard(),
    model: 'claude-sonnet-5-5',
    tools: chatTools(handlers),
    system: 'test',
    maxIterations: 4,
    maxWebSearches: 3,
  });

  it('runs a tool and answers', async () => {
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(
        message('tool_use', [toolUse('find_ideas', { query: 'rain', kind: null })]),
      )
      .mockResolvedValueOnce(message('end_turn', [text('Try cinema or bowling!')]));
    const result = await runChat([], 'Ideas for a rainy day?', deps(createMessage));
    expect(result).toEqual({ text: 'Try cinema or bowling!', status: 'done' });
    expect(handlers.findIdeas).toHaveBeenCalledWith({ query: 'rain', kind: null });
  });

  it('sends only the most recent turns of the history', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('end_turn', [text('ok')]));
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `turn ${i}`,
    }));
    await runChat(history, 'hi', deps(createMessage));
    expect(createMessage.mock.calls[0]![0].messages).toHaveLength(MAX_HISTORY_TURNS + 1);
  });

  it('stops at the iteration limit with a helpful message', async () => {
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('tool_use', [toolUse('list_plans', {})]),
    );
    const result = await runChat([], 'loop', deps(createMessage));
    expect(createMessage).toHaveBeenCalledTimes(4);
    expect(result.status).toBe('iteration_limit');
    expect(result.text).toMatch(/too many steps/);
  });
});

const plan: TripPlan = {
  title: 'Weekend in Salzburg',
  destination: 'Salzburg',
  summary: 'Old town, Mozart and Kaiserschmarrn',
  days: [
    {
      date: '2026-10-17',
      title: 'Arrival',
      items: [{ time: '10:00', title: 'Old town', description: 'Walk', link: null }],
    },
  ],
  stays: [
    { name: 'Hotel X', area: 'Altstadt', pricePerNightEur: 140, link: 'https://example.com/hotel' },
  ],
  travel: [{ from: 'Rosenheim', to: 'Salzburg', mode: 'train', notes: 'RE, ~1 h', link: null }],
  estimatedTotalEur: 450,
  tips: ['Book the fortress early'],
};
const tripInput = {
  startDate: '2026-10-17',
  endDate: '2026-10-18',
  budgetEur: 500,
  transport: 'deutschlandticket' as const,
  moods: ['culture' as const],
};

const searchResult = (url: string) =>
  ({
    type: 'web_search_tool_result',
    tool_use_id: 'srv_1',
    content: [
      { type: 'web_search_result', url, title: 'Hotel', encrypted_content: '', page_age: null },
    ],
  }) as unknown as Anthropic.ContentBlock;
const hotelSearch = searchResult('https://example.com/hotel');

describe('planTrip', () => {
  const deps = (createMessage: CreateMessage) => ({
    homeName: 'Rosenheim',
    createMessage,
    guard: guard(),
    model: 'claude-sonnet-5-5',
    maxIterations: 4,
    maxWebSearches: 15,
  });

  it('mentions the Deutschlandticket restriction and the home town', () => {
    const prompt = tripPrompt(tripInput, 'Rosenheim');
    expect(prompt).toContain('from Rosenheim, Germany');
    expect(prompt).toContain('no ICE/IC/EC');
  });

  it('lets Claude choose the transport when there is no preference', () => {
    const prompt = tripPrompt({ ...tripInput, transport: null }, 'Rosenheim');
    expect(prompt).toContain('no preference');
  });

  it('returns the submitted plan and stops right after submission', async () => {
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('tool_use', [hotelSearch, toolUse('submit_trip_plan', plan)]),
    );
    await expect(planTrip(tripInput, deps(createMessage))).resolves.toEqual(plan);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it('lets Claude fix an invalid submission', async () => {
    const createMessage = vi
      .fn<CreateMessage>()
      .mockResolvedValueOnce(
        message('tool_use', [hotelSearch, toolUse('submit_trip_plan', { ...plan, days: [] })]),
      )
      .mockResolvedValueOnce(message('tool_use', [toolUse('submit_trip_plan', plan, 'tu2')]));
    await expect(planTrip(tripInput, deps(createMessage))).resolves.toEqual(plan);
    const feedback = createMessage.mock.calls[1]![0].messages.at(-1);
    expect(JSON.stringify(feedback)).toContain('Invalid plan');
  });

  it('drops links that did not come from a search result', async () => {
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('tool_use', [
        searchResult('https://example.com/other'),
        toolUse('submit_trip_plan', plan),
      ]),
    );
    const result = await planTrip(tripInput, deps(createMessage));
    expect(result.stays[0]!.link).toBeNull();
  });

  it('rejects non-https links', async () => {
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('tool_use', [
        toolUse('submit_trip_plan', {
          ...plan,
          stays: [{ ...plan.stays[0], link: 'javascript:alert(1)' }],
        }),
      ]),
    );
    await expect(planTrip(tripInput, deps(createMessage))).rejects.toBeInstanceOf(
      TripPlanningError,
    );
  });

  it('says so when the plan was cut off for length', async () => {
    const createMessage = vi.fn<CreateMessage>(async () => message('max_tokens', [text('Day 1')]));
    await expect(planTrip(tripInput, deps(createMessage))).rejects.toThrow('too long');
  });

  it('fails cleanly when nothing is submitted within the limits', async () => {
    const createMessage = vi.fn<CreateMessage>(async () =>
      message('end_turn', [text('Here is a plan …')]),
    );
    await expect(planTrip(tripInput, deps(createMessage))).rejects.toBeInstanceOf(
      TripPlanningError,
    );
  });
});
