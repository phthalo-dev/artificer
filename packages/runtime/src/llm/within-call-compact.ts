import { generateText, type LanguageModel, type ModelMessage } from 'ai';
import {
  SUMMARIZER_SYSTEM,
  wrapCompactionSummary,
} from '../engine/agentic-compact.js';
import type { WithinCallCompactionConfig } from '../engine/compaction-config.js';
import { enforceTotalTextBudget } from './message-sanitizer.js';

export type WithinCallCompactionTier = 'none' | 'soft' | 'hard' | 'overflow';

export function assessWithinCallCompactionTier(
  estimatedChars: number,
  config: WithinCallCompactionConfig,
): WithinCallCompactionTier {
  if (!config.enabled) return 'none';
  if (estimatedChars >= config.hardThresholdChars) return 'hard';
  if (estimatedChars >= config.softThresholdChars) return 'soft';
  return 'none';
}

export interface SplitMessagesForCompaction {
  preserve: ModelMessage[];
  head: ModelMessage[];
  tail: ModelMessage[];
}

export function splitMessagesForCompaction(
  messages: ModelMessage[],
  keepRecent: number,
): SplitMessagesForCompaction {
  if (messages.length === 0) {
    return { preserve: [], head: [], tail: [] };
  }
  const preserve = [messages[0]!];
  if (messages.length <= keepRecent + 1) {
    return { preserve, head: [], tail: messages.slice(1) };
  }
  const tail = messages.slice(-keepRecent);
  const head = messages.slice(1, messages.length - keepRecent);
  return { preserve, head, tail };
}

function formatMessageContent(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    switch (part.type) {
      case 'text':
        parts.push(part.text);
        break;
      case 'reasoning':
        parts.push(`[reasoning] ${part.text}`);
        break;
      case 'tool-call':
        parts.push(
          `[tool-call ${part.toolName}] ${JSON.stringify(part.input ?? {})}`,
        );
        break;
      case 'tool-result': {
        const output =
          part.output.type === 'text'
            ? part.output.value
            : part.output.type === 'json'
              ? JSON.stringify(part.output.value)
              : `[${part.output.type}]`;
        parts.push(`[tool-result ${part.toolName}] ${output}`);
        break;
      }
      default:
        break;
    }
  }
  return parts.join('\n');
}

export function serializeMessagesForSummary(messages: ModelMessage[]): string {
  return messages
    .map((message) => {
      const body = formatMessageContent(message.content);
      return `### ${message.role}\n${body}`;
    })
    .join('\n\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function buildWithinCallSummaryRequest(input: {
  taskContext?: string;
  historyText: string;
  tier: WithinCallCompactionTier;
}): string {
  const parts = [
    'Summarize this in-progress agent tool loop for continuation.',
    'Preserve: files touched, commands run, errors, current hypothesis, what remains.',
    '',
  ];
  if (input.taskContext) {
    parts.push('## Original task (reference)', clip(input.taskContext, 4_000), '');
  }
  parts.push(
    input.tier === 'overflow'
      ? '## Urgency\nContext overflow occurred. Be extremely concise.'
      : '## Note\nMid-call compaction — recent messages below take precedence.',
    '',
    '## Tool-loop history to summarize',
    input.historyText,
    '',
    'Respond with:',
    '## Progress',
    '## Key findings',
    '## Files & commands',
    '## Next steps',
  );
  return parts.join('\n');
}

export function rebuildMessagesAfterCompaction(
  preserve: ModelMessage[],
  summary: string,
  tail: ModelMessage[],
): ModelMessage[] {
  const wrapped = wrapCompactionSummary(summary);
  const compactionMessage: ModelMessage = {
    role: 'user',
    content:
      `${wrapped}\n\nContinue from the recent tool activity below. ` +
      'Do not repeat work already captured in the summary.',
  };
  return [...preserve, compactionMessage, ...tail];
}

export async function summarizeWithinCallMessages(opts: {
  messages: ModelMessage[];
  summarizeModel: LanguageModel;
  taskContext?: string;
  maxInputChars: number;
  maxOutputTokens: number;
  tier: WithinCallCompactionTier;
  keepRecentMessages: number;
}): Promise<ModelMessage[]> {
  const { preserve, head, tail } = splitMessagesForCompaction(
    opts.messages,
    opts.keepRecentMessages,
  );
  const toSummarize =
    opts.tier === 'overflow' ? opts.messages.slice(1) : head;
  let historyText = serializeMessagesForSummary(toSummarize);
  if (opts.tier === 'hard' || opts.tier === 'overflow') {
    historyText = clip(historyText, opts.maxInputChars);
  } else {
    historyText = clip(historyText, opts.maxInputChars);
  }

  const userMessage = buildWithinCallSummaryRequest({
    taskContext: opts.taskContext,
    historyText,
    tier: opts.tier,
  });

  const result = await generateText({
    model: opts.summarizeModel,
    system: SUMMARIZER_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: opts.maxOutputTokens,
  });

  return rebuildMessagesAfterCompaction(preserve, result.text.trim(), tail);
}

export function aggressiveDeterministicCompact(
  messages: ModelMessage[],
  maxTotalTextChars: number,
): ModelMessage[] {
  const budget = Math.max(10_000, Math.floor(maxTotalTextChars * 0.4));
  return enforceTotalTextBudget(messages, budget);
}

export async function compactMessagesForWithinCall(opts: {
  messages: ModelMessage[];
  summarizeModel: LanguageModel;
  config: WithinCallCompactionConfig;
  maxInputChars: number;
  maxOutputTokens: number;
  taskContext?: string;
  tier: WithinCallCompactionTier;
  maxTotalTextChars?: number;
}): Promise<ModelMessage[]> {
  let working = opts.messages;
  if (opts.tier === 'overflow' || opts.tier === 'hard') {
    working = aggressiveDeterministicCompact(
      working,
      opts.maxTotalTextChars ?? opts.config.hardThresholdChars,
    );
  }

  try {
    return await summarizeWithinCallMessages({
      messages: working,
      summarizeModel: opts.summarizeModel,
      taskContext: opts.taskContext,
      maxInputChars: opts.maxInputChars,
      maxOutputTokens: opts.maxOutputTokens,
      tier: opts.tier,
      keepRecentMessages:
        opts.tier === 'overflow'
          ? Math.max(4, Math.floor(opts.config.keepRecentMessages / 2))
          : opts.config.keepRecentMessages,
    });
  } catch {
    return aggressiveDeterministicCompact(
      working,
      opts.maxTotalTextChars ?? opts.config.hardThresholdChars,
    );
  }
}
