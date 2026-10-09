import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { CUISINES, MOOD_TAGS } from '@/core/planner/types';
import type { activity } from '@/db/schema';
import type { CostGuard } from '@/guard/guard';
import { PLACE_TYPES } from '@/ports/place-types';
import { actualCostUsd, estimateMaxCostUsd } from './pricing';

export const IDEA_TAGS = MOOD_TAGS;

export const MAX_IDEAS = 20;

const ideaSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(300),
  kind: z.enum(['activity', 'meal', 'snack']),
  cuisine: z.enum(CUISINES).nullable(),
  tags: z.array(z.enum(IDEA_TAGS)).max(5),
  costMinEur: z.number().int().min(0).max(500),
  costMaxEur: z.number().int().min(0).max(500),
  durationMinutes: z.number().int().min(15).max(600),
  atHome: z.boolean(),
  placeType: z.enum(PLACE_TYPES).nullable(),
  placeQuery: z.string().max(80).nullable(),
  dryOnly: z.boolean(),
  minTempC: z.number().int().min(-20).max(35).nullable(),
  timesOfDay: z.array(z.enum(['morning', 'afternoon', 'evening', 'night'])).max(4),
  seasons: z.array(z.enum(['spring', 'summer', 'autumn', 'winter'])).max(4),
  preparation: z.string().max(200).nullable(),
});

export const ideasSchema = z.object({ ideas: z.array(ideaSchema).max(MAX_IDEAS) });

export type Idea = z.infer<typeof ideaSchema>;

export type IdeasContext = {
  /** Town name only – never a street address. */
  homeName: string;
  existingTitles: string[];
  count: number;
  focus?: string;
};

export function buildIdeasPrompt(ctx: IdeasContext): string {
  return [
    `Suggest ${ctx.count} new date ideas for a couple living in or near ${ctx.homeName}, Germany.`,
    'Mix going-out ideas, food (meals and small snacks like coffee or ice cream) and cozy ideas at home.',
    'Ideas must be generic (e.g. "Mini golf", "Thai dinner"), not specific venues – the app finds real places nearby itself.',
    ctx.focus ? `Focus on: ${ctx.focus}.` : '',
    '',
    'Rules:',
    '- costMinEur/costMaxEur are for both people together, in euros.',
    `- placeType must be one of: ${PLACE_TYPES.join(', ')} – or null if no venue is needed (at home, walks, …).`,
    '- placeQuery is a short German search term for the venue (e.g. "Minigolf", "Thai Restaurant"), null without venue.',
    '- kind "meal" or "snack" for food ideas; set cuisine for meals where it fits, otherwise null.',
    '- dryOnly = true for outdoor ideas that do not work in rain; minTempC if it needs warm weather.',
    '- Leave timesOfDay / seasons empty when any time works.',
    '- Do not repeat any of these existing ideas:',
    ...ctx.existingTitles.map((t) => `  - ${t}`),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Variant for the Claude app (subscription): asks for plain JSON to paste into the import. */
export function buildExportPrompt(ctx: IdeasContext): string {
  return [
    buildIdeasPrompt(ctx),
    '',
    'Answer with JSON only, exactly in this shape (no markdown):',
    JSON.stringify(
      {
        ideas: [
          {
            title: 'Mini golf',
            description: 'Short, fun description',
            kind: 'activity',
            cuisine: null,
            tags: ['outdoor', 'active'],
            costMinEur: 10,
            costMaxEur: 20,
            durationMinutes: 90,
            atHome: false,
            placeType: 'miniature_golf',
            placeQuery: 'Minigolf',
            dryOnly: true,
            minTempC: 8,
            timesOfDay: [],
            seasons: ['spring', 'summer', 'autumn'],
            preparation: null,
          },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

export class IdeasImportError extends Error {}

export function parseImport(text: string): Idea[] {
  let json: unknown;
  try {
    // Tolerate a fenced code block when the answer is pasted from a chat.
    json = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new IdeasImportError('This is not valid JSON.');
  }
  const result = ideasSchema.safeParse(Array.isArray(json) ? { ideas: json } : json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new IdeasImportError(
      `Invalid idea data${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}.`,
    );
  }
  return result.data.ideas;
}

/** Drops ideas whose title already exists (case-insensitive) or appears twice. */
export function withoutDuplicates(ideas: Idea[], existingTitles: string[]): Idea[] {
  const seen = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return ideas.filter((idea) => {
    const key = idea.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function toActivityInsert(
  idea: Idea,
  source: 'claude' | 'import',
): typeof activity.$inferInsert {
  const food = idea.kind !== 'activity';
  const tags = [
    ...(food ? ['food', idea.kind] : []),
    ...(food && idea.kind === 'meal' && idea.cuisine ? [idea.cuisine] : []),
    ...idea.tags,
  ];
  return {
    title: idea.title.trim(),
    description: idea.description,
    category: food ? 'food' : idea.atHome ? 'home' : 'activity',
    tags: [...new Set(tags)],
    costMinEur: Math.min(idea.costMinEur, idea.costMaxEur),
    costMaxEur: Math.max(idea.costMinEur, idea.costMaxEur),
    durationMinutes: idea.durationMinutes,
    weather: {
      ...(idea.dryOnly ? { dryOnly: true } : {}),
      ...(idea.minTempC !== null ? { minTempC: idea.minTempC } : {}),
    },
    transports: [],
    atHome: idea.atHome,
    placeType: idea.atHome ? null : idea.placeType,
    placeQuery: idea.atHome || !idea.placeType ? null : (idea.placeQuery ?? idea.title),
    timesOfDay: idea.timesOfDay,
    seasons: idea.seasons,
    preparation: idea.preparation,
    status: 'draft',
    source,
  };
}

type ParseParams = Parameters<Anthropic['beta']['messages']['parse']>[0];
type ParsedResponse = {
  stop_reason: string | null;
  model: string;
  usage: Parameters<typeof actualCostUsd>[1];
  parsed_output: z.infer<typeof ideasSchema> | null;
};
export type ParseMessage = (params: ParseParams) => Promise<ParsedResponse>;

export class IdeasGenerationError extends Error {}

const MAX_TOKENS = 8_000;

/** One guarded API call; returns validated ideas (not yet deduplicated). */
export async function generateIdeas(
  ctx: IdeasContext,
  deps: { parse: ParseMessage; guard: CostGuard; model: string },
): Promise<Idea[]> {
  const params: ParseParams = {
    model: deps.model,
    max_tokens: MAX_TOKENS,
    betas: ['server-side-fallback-2026-07-01'],
    // A refused request is retried server-side on a suitable model instead of failing.
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(ideasSchema) },
    messages: [{ role: 'user', content: buildIdeasPrompt(ctx) }],
  };
  const estimate = estimateMaxCostUsd(
    { model: deps.model, max_tokens: MAX_TOKENS },
    JSON.stringify(params.messages).length + 4_000,
    0,
    true,
  );
  const response = await deps.guard.run('anthropic', estimate, async () => {
    const res = await deps.parse(params);
    return { result: res, actualCostUsd: actualCostUsd(res.model, res.usage) };
  });
  if (response.stop_reason === 'refusal') {
    throw new IdeasGenerationError('Claude declined this request. Try a different focus.');
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new IdeasGenerationError('Claude returned incomplete ideas. Please try again.');
  }
  return response.parsed_output.ideas.slice(0, ctx.count);
}
