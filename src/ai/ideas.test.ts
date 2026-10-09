import { describe, expect, it, vi } from 'vitest';
import { CostGuard, GuardDeniedError } from '@/guard/guard';
import { MemoryUsageStore } from '@/guard/memory-store';
import type { GuardLimits } from '@/guard/types';
import {
  buildExportPrompt,
  buildIdeasPrompt,
  generateIdeas,
  IdeasGenerationError,
  IdeasImportError,
  parseImport,
  toActivityInsert,
  withoutDuplicates,
  type Idea,
  type ParseMessage,
} from './ideas';

const idea = (overrides: Partial<Idea> = {}): Idea => ({
  title: 'Thai dinner',
  description: 'Spicy curry night',
  kind: 'meal',
  cuisine: 'asian',
  tags: ['chill'],
  costMinEur: 30,
  costMaxEur: 50,
  durationMinutes: 90,
  atHome: false,
  placeType: 'restaurant',
  placeQuery: 'Thai Restaurant',
  dryOnly: false,
  minTempC: null,
  timesOfDay: ['evening'],
  seasons: [],
  preparation: null,
  ...overrides,
});

const limits: GuardLimits = {
  providers: {
    anthropic: { dailyCostUsd: 2, monthlyCostUsd: 15, dailyRequests: 200 },
    google_places: { dailyRequests: 25 },
  },
  callsPerMinute: 100,
  circuitBreaker: { failureThreshold: 5, cooldownMs: 600_000 },
};

const ctx = { homeName: 'Rosenheim', existingTitles: ['Mini golf', 'Cinema'], count: 10 };

function response(overrides: Partial<Awaited<ReturnType<ParseMessage>>> = {}) {
  return {
    stop_reason: 'end_turn',
    model: 'claude-sonnet-5-5',
    usage: {
      input_tokens: 2_000,
      output_tokens: 3_000,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    parsed_output: {
      ideas: [idea(), idea({ title: 'Pottery class', kind: 'activity', cuisine: null })],
    },
    ...overrides,
  };
}

describe('prompts', () => {
  it('names only the town and lists existing ideas and allowed place types', () => {
    const prompt = buildIdeasPrompt({ ...ctx, focus: 'rainy days' });
    expect(prompt).toContain('Rosenheim, Germany');
    expect(prompt).toContain('  - Mini golf');
    expect(prompt).toContain('miniature_golf');
    expect(prompt).toContain('Focus on: rainy days.');
  });

  it('asks for importable JSON in the export variant', () => {
    const exported = buildExportPrompt(ctx);
    const example = exported.slice(exported.indexOf('{'));
    expect(parseImport(example)).toHaveLength(1);
  });
});

describe('parseImport', () => {
  it('accepts an object, a bare array and a fenced code block', () => {
    expect(parseImport(JSON.stringify({ ideas: [idea()] }))).toHaveLength(1);
    expect(parseImport(JSON.stringify([idea(), idea({ title: 'Bowling' })]))).toHaveLength(2);
    expect(parseImport('```json\n' + JSON.stringify([idea()]) + '\n```')).toHaveLength(1);
  });

  it('rejects invalid JSON and invalid fields with a readable message', () => {
    expect(() => parseImport('not json')).toThrow(IdeasImportError);
    expect(() => parseImport(JSON.stringify([idea({ placeType: 'spaceship' as never })]))).toThrow(
      /placeType/,
    );
  });

  it('rejects more than 20 ideas at once', () => {
    const many = Array.from({ length: 21 }, (_, i) => idea({ title: `Idea ${i}` }));
    expect(() => parseImport(JSON.stringify(many))).toThrow(IdeasImportError);
  });
});

describe('withoutDuplicates', () => {
  it('drops existing and repeated titles case-insensitively', () => {
    const result = withoutDuplicates(
      [idea({ title: 'mini golf' }), idea({ title: 'Karaoke' }), idea({ title: 'karaoke ' })],
      ['Mini golf'],
    );
    expect(result.map((i) => i.title)).toEqual(['Karaoke']);
  });
});

describe('toActivityInsert', () => {
  it('maps meals to food tags with cuisine and stores them as drafts', () => {
    const row = toActivityInsert(idea(), 'claude');
    expect(row).toMatchObject({ category: 'food', status: 'draft', source: 'claude' });
    expect(row.tags).toEqual(['food', 'meal', 'asian', 'chill']);
  });

  it('never stores a venue for home ideas', () => {
    const row = toActivityInsert(
      idea({
        kind: 'activity',
        cuisine: null,
        atHome: true,
        placeType: 'cinema',
        placeQuery: 'Kino',
      }),
      'import',
    );
    expect(row).toMatchObject({ category: 'home', placeType: null, placeQuery: null });
  });

  it('normalises swapped cost ranges and weather flags', () => {
    const row = toActivityInsert(
      idea({ kind: 'activity', costMinEur: 40, costMaxEur: 10, dryOnly: true, minTempC: 12 }),
      'import',
    );
    expect(row).toMatchObject({
      costMinEur: 10,
      costMaxEur: 40,
      weather: { dryOnly: true, minTempC: 12 },
    });
  });
});

describe('generateIdeas', () => {
  const guard = () => new CostGuard({ store: new MemoryUsageStore(), limits });

  it('makes one bounded call with structured output and refusal fallback', async () => {
    const parse = vi.fn<ParseMessage>(async () => response());
    const ideas = await generateIdeas(ctx, { parse, guard: guard(), model: 'claude-sonnet-5-5' });
    expect(ideas).toHaveLength(2);
    expect(parse).toHaveBeenCalledTimes(1);
    const params = parse.mock.calls[0]![0];
    expect(params.max_tokens).toBe(8_000);
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
  });

  it('turns refusals and truncated output into readable errors', async () => {
    const refused = vi.fn<ParseMessage>(async () =>
      response({ stop_reason: 'refusal', parsed_output: null }),
    );
    await expect(
      generateIdeas(ctx, { parse: refused, guard: guard(), model: 'claude-sonnet-5-5' }),
    ).rejects.toThrow(IdeasGenerationError);
    const cut = vi.fn<ParseMessage>(async () =>
      response({ stop_reason: 'max_tokens', parsed_output: null }),
    );
    await expect(
      generateIdeas(ctx, { parse: cut, guard: guard(), model: 'claude-sonnet-5-5' }),
    ).rejects.toThrow(IdeasGenerationError);
  });

  it('does not call Claude when the budget is exhausted', async () => {
    const tight = new CostGuard({
      store: new MemoryUsageStore(),
      limits: {
        ...limits,
        providers: {
          ...limits.providers,
          anthropic: { dailyCostUsd: 0.05, monthlyCostUsd: 15, dailyRequests: 200 },
        },
      },
    });
    const parse = vi.fn<ParseMessage>(async () => response());
    await expect(
      generateIdeas(ctx, { parse, guard: tight, model: 'claude-sonnet-5-5' }),
    ).rejects.toBeInstanceOf(GuardDeniedError);
    expect(parse).not.toHaveBeenCalled();
  });
});
