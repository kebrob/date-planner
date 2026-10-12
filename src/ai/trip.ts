import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MOOD_TAGS } from '@/core/planner/types';
import type { CostGuard } from '@/guard/guard';
import {
  runToolLoop,
  UNTRUSTED_CONTENT_RULE,
  type ClientTool,
  type CreateMessage,
} from './tool-loop';

const url = z
  .string()
  .max(500)
  .regex(/^https:\/\/[^\s]+$/, 'https link');

export const tripPlanSchema = z.object({
  title: z.string().min(2).max(100),
  destination: z.string().max(100),
  summary: z.string().max(600),
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string().max(100),
        items: z
          .array(
            z.object({
              time: z.string().max(20).nullable(),
              title: z.string().max(120),
              description: z.string().max(400),
              link: url.nullable(),
            }),
          )
          .max(12),
      }),
    )
    .min(1)
    .max(14),
  stays: z
    .array(
      z.object({
        name: z.string().max(120),
        area: z.string().max(100),
        pricePerNightEur: z.number().int().min(0).max(2000).nullable(),
        link: url.nullable(),
      }),
    )
    .max(5),
  travel: z
    .array(
      z.object({
        from: z.string().max(100),
        to: z.string().max(100),
        mode: z.enum(['train', 'car', 'flight', 'bus', 'other']),
        notes: z.string().max(300),
        link: url.nullable(),
      }),
    )
    .max(6),
  estimatedTotalEur: z.number().int().min(0).max(20_000).nullable(),
  tips: z.array(z.string().max(200)).max(8),
});

export type TripPlan = z.infer<typeof tripPlanSchema>;

export const tripInputSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    budgetEur: z.number().int().min(0).max(20_000),
    /** Null = no preference. */
    transport: z.enum(['deutschlandticket', 'train', 'bus', 'car', 'flight']).nullable(),
    moods: z.array(z.enum(MOOD_TAGS)).max(5),
    destination: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, { message: 'End must not be before start' })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <= 13, {
    message: 'Trips are limited to 14 days',
  });

export type TripInput = z.infer<typeof tripInputSchema>;

const TRANSPORT_TEXT: Record<NonNullable<TripInput['transport']>, string> = {
  deutschlandticket: 'regional trains only (Deutschlandticket: no ICE/IC/EC)',
  car: 'their own car',
  train: 'any trains including long-distance',
  bus: 'long-distance buses such as FlixBus, plus regional trains',
  flight: 'a flight is fine for longer distances',
};

export function tripPrompt(input: TripInput, homeName: string): string {
  return [
    `Plan a trip for a couple from ${homeName}, Germany, from ${input.startDate} to ${input.endDate}.`,
    `Total budget for both: about ${input.budgetEur} € including travel and accommodation.`,
    input.transport
      ? `Getting there: ${TRANSPORT_TEXT[input.transport]}.`
      : 'Getting there: no preference – choose what suits budget and distance (train, bus, car or flight).',
    input.destination
      ? `Destination: ${input.destination}.`
      : 'Suggest a fitting destination yourself.',
    input.moods.length ? `They like: ${input.moods.join(', ')}.` : '',
    input.notes ? `Notes: ${input.notes}` : '',
    '',
    'Use web search for current opening times, events, accommodation and connections.',
    'Only use links that appeared in your search results; use null when you have none.',
    'This is a suggestion only – never claim anything is booked or reserved.',
    'When done, call submit_trip_plan exactly once with the full plan (one day entry per date).',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// Room for long trips plus thinking; calls are streamed, so the SDK accepts it. Reserved per call
// at the output price, so it is not set higher than needed.
const MAX_TOKENS = 32_000;

function tripToolSchema() {
  const schema = { ...(z.toJSONSchema(tripPlanSchema) as Record<string, unknown>) };
  delete schema.$schema;
  return schema as { type: 'object' } & Record<string, unknown>;
}

export class TripPlanningError extends Error {}

const normalizedUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return url;
  }
};

/** URLs of all web search results in the conversation. */
export function searchedUrls(messages: Anthropic.MessageParam[]): Set<string> {
  const urls = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue;
      for (const result of block.content) urls.add(normalizedUrl(result.url));
    }
  }
  return urls;
}

/**
 * Keeps only links that came from a search result. Search results are untrusted text, so an
 * injected instruction could otherwise make Claude add any link as a button.
 */
export function withSearchedLinks(plan: TripPlan, urls: Set<string>): TripPlan {
  const known = (link: string | null) => (link && urls.has(normalizedUrl(link)) ? link : null);
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      items: day.items.map((item) => ({ ...item, link: known(item.link) })),
    })),
    stays: plan.stays.map((stay) => ({ ...stay, link: known(stay.link) })),
    travel: plan.travel.map((leg) => ({ ...leg, link: known(leg.link) })),
  };
}

export async function planTrip(
  input: TripInput,
  deps: {
    homeName: string;
    createMessage: CreateMessage;
    guard: CostGuard;
    model: string;
    maxIterations: number;
    maxWebSearches: number;
  },
): Promise<TripPlan> {
  let submitted: TripPlan | null = null;
  const submit: ClientTool = {
    definition: {
      name: 'submit_trip_plan',
      description: 'Submits the final trip plan. Call exactly once at the end.',
      // Mirrors tripPlanSchema; validated again on receipt.
      input_schema: tripToolSchema(),
    },
    execute: async (raw) => {
      const parsed = tripPlanSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `Invalid plan at ${issue?.path.join('.')}: ${issue?.message}. Fix and resubmit.`,
        );
      }
      submitted = parsed.data;
      return 'Plan received.';
    },
  };

  const result = await runToolLoop({
    createMessage: deps.createMessage,
    guard: deps.guard,
    model: deps.model,
    maxTokens: MAX_TOKENS,
    system: [
      'You are a careful travel planner. Be concrete and realistic about times, prices and distances.',
      UNTRUSTED_CONTENT_RULE,
    ].join('\n'),
    messages: [{ role: 'user', content: tripPrompt(input, deps.homeName) }],
    tools: [submit],
    maxIterations: deps.maxIterations,
    maxWebSearches: deps.maxWebSearches,
    effort: 'medium',
    isDone: () => submitted !== null,
  });

  if (!submitted) {
    const reasons: Partial<Record<typeof result.status, string>> = {
      refusal: 'Claude declined this request.',
      max_tokens: 'The plan got too long. Try fewer days or a shorter request.',
    };
    throw new TripPlanningError(
      reasons[result.status] ??
        'Claude could not finish the plan within the limits. Try again or simplify the request.',
    );
  }
  return withSearchedLinks(submitted, searchedUrls(result.messages));
}
