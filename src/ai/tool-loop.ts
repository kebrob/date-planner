import type Anthropic from '@anthropic-ai/sdk';
import type { CostGuard } from '@/guard/guard';
import { actualCostUsd, estimateMaxCostUsd } from './pricing';

export type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

export type ClientTool = {
  definition: Anthropic.Tool;
  execute: (input: unknown) => Promise<string>;
};

export type ToolLoopOptions = {
  createMessage: CreateMessage;
  guard: CostGuard;
  model: string;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  tools: ClientTool[];
  maxIterations: number;
  /** Total web searches allowed across all iterations of this loop; 0 disables web search. */
  maxWebSearches: number;
  effort?: 'low' | 'medium' | 'high';
  /** Stops the loop early once this returns true (e.g. a final "submit" tool was called). */
  isDone?: () => boolean;
};

export type ToolLoopResult = {
  status: 'done' | 'iteration_limit' | 'refusal' | 'max_tokens';
  text: string;
  messages: Anthropic.MessageParam[];
  iterations: number;
  webSearches: number;
};

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function runClientTools(
  message: Anthropic.Message,
  tools: ClientTool[],
): Promise<Anthropic.ToolResultBlockParam[]> {
  const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  return Promise.all(
    calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
      const tool = tools.find((t) => t.definition.name === call.name);
      if (!tool) {
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Unknown tool ${call.name}`,
          is_error: true,
        };
      }
      try {
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: await tool.execute(call.input),
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Tool failed';
        return { type: 'tool_result', tool_use_id: call.id, content: reason, is_error: true };
      }
    }),
  );
}

/**
 * Agentic loop with hard upper bounds: at most `maxIterations` API calls and `maxWebSearches`
 * searches in total, every call reserved through the cost guard.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const messages = [...options.messages];
  let webSearches = 0;
  let lastText = '';

  for (let iteration = 1; iteration <= options.maxIterations; iteration++) {
    const remainingSearches = Math.max(0, options.maxWebSearches - webSearches);
    const tools: Anthropic.ToolUnion[] = options.tools.map((t) => t.definition);
    if (remainingSearches > 0) {
      tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: remainingSearches });
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: options.model,
      max_tokens: options.maxTokens,
      system: options.system,
      messages: [...messages],
      tools,
      ...(options.effort ? { output_config: { effort: options.effort } } : {}),
    };
    const estimate = estimateMaxCostUsd(params, JSON.stringify(params).length, remainingSearches);

    const message = await options.guard.run('anthropic', estimate, async () => {
      const response = await options.createMessage(params);
      return { result: response, actualCostUsd: actualCostUsd(options.model, response.usage) };
    });

    webSearches += message.usage.server_tool_use?.web_search_requests ?? 0;
    lastText = textOf(message) || lastText;
    messages.push({ role: 'assistant', content: message.content });

    const result = (status: ToolLoopResult['status']): ToolLoopResult => ({
      status,
      text: lastText,
      messages,
      iterations: iteration,
      webSearches,
    });

    switch (message.stop_reason) {
      case 'tool_use': {
        const results = await runClientTools(message, options.tools);
        if (results.length > 0) messages.push({ role: 'user', content: results });
        if (options.isDone?.()) return result('done');
        break;
      }
      // Server-side search loop paused; resending the conversation continues it.
      case 'pause_turn':
        break;
      case 'refusal':
        return result('refusal');
      case 'max_tokens':
        return result('max_tokens');
      default:
        return result('done');
    }
  }

  return {
    status: 'iteration_limit',
    text: lastText,
    messages,
    iterations: options.maxIterations,
    webSearches,
  };
}
