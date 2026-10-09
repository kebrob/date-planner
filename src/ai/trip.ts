import { z } from 'zod';
import { MOOD_TAGS } from '@/core/planner/types';
import type { CostGuard } from '@/guard/guard';
import { runToolLoop, type ClientTool, type CreateMessage } from './tool-loop';

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
    transport: z.enum(['deutschlandticket', 'car', 'train', 'flight']),
    moods: z.array(z.enum(MOOD_TAGS)).max(5),
    destination: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, { message: 'End must not be before start' })
  .refine((v) => (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 <= 13, {
    message: 'Trips are limited to 14 days',
  });

export type TripInput = z.infer<typeof tripInputSchema>;

const TRANSPORT_TEXT: Record<TripInput['transport'], string> = {
  deutschlandticket: 'regional trains only (Deutschlandticket: no ICE/IC/EC)',
  car: 'their own car',
  train: 'any trains including long-distance',
  flight: 'a flight is fine for longer distances',
};

export function tripPrompt(input: TripInput, homeName: string): string {
  return [
    `Plan a trip for a couple from ${homeName}, Germany, from ${input.startDate} to ${input.endDate}.`,
    `Total budget for both: about ${input.budgetEur} € including travel and accommodation.`,
    `Getting there: ${TRANSPORT_TEXT[input.transport]}.`,
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

const MAX_TOKENS = 8_000;

function tripToolSchema() {
  const schema = { ...(z.toJSONSchema(tripPlanSchema) as Record<string, unknown>) };
  delete schema.$schema;
  return schema as { type: 'object' } & Record<string, unknown>;
}

export class TripPlanningError extends Error {}

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
    system:
      'You are a careful travel planner. Be concrete and realistic about times, prices and distances.',
    messages: [{ role: 'user', content: tripPrompt(input, deps.homeName) }],
    tools: [submit],
    maxIterations: deps.maxIterations,
    maxWebSearches: deps.maxWebSearches,
    effort: 'medium',
    isDone: () => submitted !== null,
  });

  if (!submitted) {
    throw new TripPlanningError(
      result.status === 'refusal'
        ? 'Claude declined this request.'
        : 'Claude could not finish the plan within the limits. Try again or simplify the request.',
    );
  }
  return submitted;
}
