import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CUISINES, MOOD_TAGS } from '@/core/planner/types';
import type { CostGuard } from '@/guard/guard';
import { logError } from '@/lib/result';
import { PLACE_TYPES } from '@/ports/place-types';
import { runToolLoop, type ClientTool, type CreateMessage, type ToolLoopResult } from './tool-loop';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

// Only the most recent turns are sent, which bounds input tokens per message.
export const MAX_HISTORY_TURNS = 12;
const MAX_TOKENS = 4_000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const transport = z.enum(['deutschlandticket', 'car', 'walk']);

export const planDateInput = z.object({
  date,
  start_time: time,
  end_time: time,
  end_date: date.nullable(),
  budget_eur: z.number().int().min(0).max(2000).nullable(),
  transport: transport.nullable(),
  moods: z.array(z.enum(MOOD_TAGS)).max(5),
  food: z.enum(['auto', 'none', 'snack', 'meal']).nullable(),
  cuisine: z.enum(CUISINES).nullable(),
  area: z.string().max(100).nullable(),
  max_distance_km: z.number().int().min(1).max(300).nullable(),
  must_include: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        search_query: z.string().max(80).nullable(),
        kind: z.enum(['activity', 'meal', 'snack']),
        duration_minutes: z.number().int().min(15).max(480),
        cost_eur: z.number().int().min(0).max(1000),
      }),
    )
    .max(3),
});

export const weatherInput = z.object({ date, town: z.string().max(100).nullable() });
export const findIdeasInput = z.object({
  query: z.string().max(80).nullable(),
  kind: z.enum(['activity', 'meal', 'snack', 'home']).nullable(),
});
export const saveIdeaInput = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(300),
  kind: z.enum(['activity', 'meal', 'snack']),
  cuisine: z.enum(CUISINES).nullable(),
  tags: z.array(z.enum(MOOD_TAGS)).max(5),
  cost_min_eur: z.number().int().min(0).max(500),
  cost_max_eur: z.number().int().min(0).max(500),
  duration_minutes: z.number().int().min(15).max(600),
  at_home: z.boolean(),
  place_type: z.enum(PLACE_TYPES).nullable(),
  place_query: z.string().max(80).nullable(),
  dry_only: z.boolean(),
});

/** Errors whose message is meant for the model (e.g. "town not found"). */
export class ToolUserError extends Error {}

export type ChatToolHandlers = {
  planDate: (input: z.infer<typeof planDateInput>) => Promise<string>;
  weather: (input: z.infer<typeof weatherInput>) => Promise<string>;
  findIdeas: (input: z.infer<typeof findIdeasInput>) => Promise<string>;
  saveIdea: (input: z.infer<typeof saveIdeaInput>) => Promise<string>;
  listPlans: () => Promise<string>;
};

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const str = (description: string) => ({ type: 'string', description });

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  schema: z.ZodType,
  run: (input: never) => Promise<string>,
): ClientTool {
  return {
    definition: {
      name,
      description,
      strict: true,
      input_schema: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    },
    execute: async (raw) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid input: ${parsed.error.issues[0]?.message}`);
      try {
        return await run(parsed.data as never);
      } catch (error) {
        if (error instanceof ToolUserError) throw error;
        // Internal details (SQL, hosts, stack) stay in our logs and are never sent to the model.
        logError(`chat tool ${name} failed`, error);
        throw new Error('The app had an internal error running this tool. Do not retry it now.');
      }
    },
  };
}

export function chatTools(h: ChatToolHandlers): ClientTool[] {
  const enumOf = (values: readonly string[]) => ({ type: 'string', enum: values });
  return [
    tool(
      'plan_date',
      'Builds a concrete date plan (real venues, times, travel, costs, weather) with the app planner. The user sees the plan as a card and can save it. Use whenever the user wants a plan.',
      {
        date: str('Start date YYYY-MM-DD'),
        start_time: str('HH:MM, local time'),
        end_time: str('HH:MM, local time'),
        end_date: nullable(str('YYYY-MM-DD if the plan ends on a later day')),
        budget_eur: nullable({ type: 'integer', description: 'Budget for both in euros' }),
        transport: nullable(enumOf(['deutschlandticket', 'car', 'walk'])),
        moods: { type: 'array', items: enumOf(MOOD_TAGS) },
        food: nullable(enumOf(['auto', 'none', 'snack', 'meal'])),
        cuisine: nullable(enumOf(CUISINES)),
        area: nullable(str('Town to go to, e.g. "München"; null = near home')),
        max_distance_km: nullable({
          type: 'integer',
          description:
            'Max distance from home for the first stop; null = derived from the time window',
        }),
        must_include: {
          type: 'array',
          description:
            'Stops the user explicitly wants (max. 3), e.g. shopping or a specific kind of restaurant',
          items: {
            type: 'object',
            properties: {
              title: str('Short title, e.g. "Shopping in the city centre"'),
              search_query: nullable(
                str('German place search term, e.g. "Einkaufsstraße", "Sushi"; null if no venue'),
              ),
              kind: enumOf(['activity', 'meal', 'snack']),
              duration_minutes: { type: 'integer' },
              cost_eur: { type: 'integer', description: 'Estimated cost for both' },
            },
            required: ['title', 'search_query', 'kind', 'duration_minutes', 'cost_eur'],
            additionalProperties: false,
          },
        },
      },
      planDateInput,
      h.planDate,
    ),
    tool(
      'get_weather',
      'Weather forecast summary for a day (up to 16 days ahead).',
      { date: str('YYYY-MM-DD'), town: nullable(str('Town; null = home')) },
      weatherInput,
      h.weather,
    ),
    tool(
      'find_ideas',
      "Searches the couple's own idea catalog (activities, meals, snacks, home ideas).",
      {
        query: nullable(str('Words to search in titles and descriptions')),
        kind: nullable(enumOf(['activity', 'meal', 'snack', 'home'])),
      },
      findIdeasInput,
      h.findIdeas,
    ),
    tool(
      'save_idea',
      'Saves a new generic idea as a draft in the catalog (reviewed later in the admin area). Only when the user asks to keep an idea.',
      {
        title: str('Generic idea, not a specific venue'),
        description: str('One sentence'),
        kind: enumOf(['activity', 'meal', 'snack']),
        cuisine: nullable(enumOf(CUISINES)),
        tags: { type: 'array', items: enumOf(MOOD_TAGS) },
        cost_min_eur: { type: 'integer', description: 'For both people' },
        cost_max_eur: { type: 'integer', description: 'For both people' },
        duration_minutes: { type: 'integer' },
        at_home: { type: 'boolean' },
        place_type: nullable(enumOf(PLACE_TYPES)),
        place_query: nullable(str('Short German search term for the venue')),
        dry_only: { type: 'boolean', description: 'Does not work in rain' },
      },
      saveIdeaInput,
      h.saveIdea,
    ),
    tool(
      'list_plans',
      "Lists the couple's upcoming saved date plans.",
      {},
      z.object({}),
      h.listPlans,
    ),
  ];
}

export function systemPrompt(ctx: {
  homeName: string;
  today: string;
  weekday: string;
  defaultBudgetEur: number;
  defaultTransport: string;
}): string {
  return [
    `You help a couple living near ${ctx.homeName}, Germany, plan dates. Today is ${ctx.weekday}, ${ctx.today} (Europe/Berlin).`,
    'Always answer in the language of the user\'s latest message (English if they write in English), short and friendly, as plain text without Markdown (no **, #, tables); simple "- " lists are fine.',
    'Cozy plans at home are just as valid as going out.',
    `Before calling plan_date, make sure you know the budget and how they travel. If the user did not say, ask one short question first and offer the defaults (${ctx.defaultBudgetEur} € for both, ${ctx.defaultTransport}) – unless they ask you to just plan it. Ask at most once, then plan.`,
    'Stops the user explicitly wants (e.g. shopping, sushi) go into must_include with a German search_query, so the planner really includes them.',
    'Translate wishes into moods for plan_date: cozy/relaxed/lazy → chill (a short walk of up to about an hour counts as cozy too), romantic → romantic, sporty/active → active, with friends/people → social, museum/art/culture → culture, at home → home.',
    'Use plan_date for concrete plans instead of inventing venues or times; summarise the result briefly – the user sees the full plan as a card below your message.',
    'If plan_date reports warnings (fallback, limits, skipped stops), say honestly what went wrong and how to fix it (e.g. higher budget, other day, smaller distance).',
    'Use web search only for current events or facts you cannot know (max. a few searches) and mention sources.',
    'Never book or buy anything; you can only suggest and link.',
  ].join('\n');
}

export type ChatResult = {
  text: string;
  status: ToolLoopResult['status'];
};

export async function runChat(
  history: ChatTurn[],
  message: string,
  deps: {
    createMessage: CreateMessage;
    guard: CostGuard;
    model: string;
    tools: ClientTool[];
    system: string;
    maxIterations: number;
    maxWebSearches: number;
  },
): Promise<ChatResult> {
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.text })),
    { role: 'user' as const, content: message },
  ];
  const result = await runToolLoop({
    createMessage: deps.createMessage,
    guard: deps.guard,
    model: deps.model,
    maxTokens: MAX_TOKENS,
    system: deps.system,
    messages,
    tools: deps.tools,
    maxIterations: deps.maxIterations,
    maxWebSearches: deps.maxWebSearches,
    effort: 'low',
  });
  const fallbackText: Record<ChatResult['status'], string> = {
    done: '',
    iteration_limit: 'That took too many steps – please ask a bit more specifically.',
    refusal: 'Sorry, I cannot help with that.',
    max_tokens: '',
    interrupted: 'I had to stop early (time or usage limit) – here is what I have so far.',
  };
  // An interrupted answer may end mid-thought, so the note is always added.
  const text =
    result.status === 'interrupted'
      ? [result.text, fallbackText.interrupted].filter(Boolean).join('\n\n')
      : result.text || fallbackText[result.status];
  return { text, status: result.status };
}
