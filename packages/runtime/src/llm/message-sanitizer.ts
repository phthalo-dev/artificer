import type { ModelMessage, ToolResultPart } from 'ai';

type ToolResultOutput = ToolResultPart['output'];

export const OUTDATED_FILE_CONTENT = '[outdated - see the latest file content]';

export const CLEARED_WITHIN_CALL_OUTPUT = '[Old tool output cleared]';

const MICROCOMPACTABLE_TOOLS = new Set([
  'read_file',
  'run_shell',
  'grep',
  'glob',
  'fetch_url',
]);

const TRUNCATE_MARKER = (removed: number) =>
  `\n\n...[truncated ${removed} chars]...\n\n`;

function parseToolInput(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractReadFilePath(input: unknown): string | undefined {
  const record = parseToolInput(input);
  if (!record) {
    return undefined;
  }
  for (const key of ['path', 'file_path', 'filePath'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return normalizePath(value);
    }
  }
  return undefined;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function getToolResultText(output: unknown): string | undefined {
  if (typeof output === 'string') {
    return output;
  }
  if (output && typeof output === 'object') {
    const record = output as { type?: string; value?: unknown };
    if (record.type === 'text' && typeof record.value === 'string') {
      return record.value;
    }
    if (record.type === 'json' && record.value != null) {
      return JSON.stringify(record.value);
    }
  }
  return undefined;
}

function replaceToolResultText(output: unknown, text: string): ToolResultOutput {
  if (typeof output === 'string') {
    return { type: 'text', value: text };
  }
  if (output && typeof output === 'object') {
    const record = output as ToolResultOutput;
    if (record.type === 'text') {
      return { ...record, value: text };
    }
    if (record.type === 'json') {
      return { type: 'text', value: text };
    }
  }
  return { type: 'text', value: text };
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 0) {
    return '';
  }
  const tentativeMarker = TRUNCATE_MARKER(text.length - maxChars);
  const tentativeKeep = Math.max(
    0,
    Math.floor((maxChars - tentativeMarker.length) / 2),
  );
  const removed = Math.max(0, text.length - tentativeKeep * 2);
  const marker = TRUNCATE_MARKER(removed);
  const keep = Math.max(0, Math.floor((maxChars - marker.length) / 2));
  const start = text.slice(0, keep);
  const end = keep > 0 ? text.slice(-keep) : '';
  const result = `${start}${marker}${end}`;
  return result.length > maxChars ? result.slice(0, maxChars) : result;
}

function isToolCallPart(part: unknown): part is {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
} {
  return (
    !!part &&
    typeof part === 'object' &&
    (part as { type?: string }).type === 'tool-call' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string' &&
    typeof (part as { toolName?: unknown }).toolName === 'string'
  );
}

function isToolResultPart(part: unknown): part is ToolResultPart {
  return (
    !!part &&
    typeof part === 'object' &&
    (part as { type?: string }).type === 'tool-result' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  );
}

function collectOutdatedReadToolCallIds(messages: ModelMessage[]): Set<string> {
  const latestReadByPath = new Map<string, string>();
  const outdated = new Set<string>();

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (!isToolCallPart(part) || part.toolName !== 'read_file') {
        continue;
      }
      const path = extractReadFilePath(part.input);
      if (!path) {
        continue;
      }
      const previous = latestReadByPath.get(path);
      if (previous) {
        outdated.add(previous);
      }
      latestReadByPath.set(path, part.toolCallId);
    }
  }

  return outdated;
}

function collectCompactableToolCallIds(messages: ModelMessage[]): string[] {
  const toolNameByCallId = new Map<string, string>();
  const orderedIds: string[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (!isToolCallPart(part)) continue;
      toolNameByCallId.set(part.toolCallId, part.toolName);
    }
  }

  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (!isToolResultPart(part)) continue;
      const toolName = toolNameByCallId.get(part.toolCallId);
      if (!toolName || !MICROCOMPACTABLE_TOOLS.has(toolName)) continue;
      orderedIds.push(part.toolCallId);
    }
  }

  return orderedIds;
}

/** Clear older compactable tool results within a single call, keeping the newest N. */
export function microcompactOldToolResults(
  messages: ModelMessage[],
  keepRecent = 8,
): ModelMessage[] {
  const orderedIds = collectCompactableToolCallIds(messages);
  if (orderedIds.length <= keepRecent) {
    return messages;
  }
  const clearIds = new Set(orderedIds.slice(0, orderedIds.length - keepRecent));

  return messages.map((message) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }
    let changed = false;
    const content = message.content.map((part) => {
      if (!isToolResultPart(part) || !clearIds.has(part.toolCallId)) {
        return part;
      }
      const text = getToolResultText(part.output);
      if (text === CLEARED_WITHIN_CALL_OUTPUT) {
        return part;
      }
      changed = true;
      return {
        ...part,
        output: replaceToolResultText(part.output, CLEARED_WITHIN_CALL_OUTPUT),
      };
    });
    return changed ? { ...message, content } : message;
  });
}

export function invalidateOutdatedReads(messages: ModelMessage[]): ModelMessage[] {
  const outdatedToolCallIds = collectOutdatedReadToolCallIds(messages);
  if (outdatedToolCallIds.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }

    let changed = false;
    const content = message.content.map((part) => {
      if (!isToolResultPart(part) || !outdatedToolCallIds.has(part.toolCallId)) {
        return part;
      }
      changed = true;
      return {
        ...part,
        output: replaceToolResultText(part.output, OUTDATED_FILE_CONTENT),
      };
    });

    return changed ? { ...message, content } : message;
  });
}

export function truncateToolResults(
  messages: ModelMessage[],
  maxChars: number,
): ModelMessage[] {
  if (maxChars <= 0) {
    return messages;
  }

  return messages.map((message) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }

    let changed = false;
    const content = message.content.map((part) => {
      if (!isToolResultPart(part)) {
        return part;
      }
      const text = getToolResultText(part.output);
      if (text == null || text.length <= maxChars) {
        return part;
      }
      changed = true;
      return {
        ...part,
        output: replaceToolResultText(part.output, truncateMiddle(text, maxChars)),
      };
    });

    return changed ? { ...message, content } : message;
  });
}

function countPartTextChars(part: unknown): number {
  if (!part || typeof part !== 'object') {
    return 0;
  }
  const typed = part as { type?: string; text?: string; output?: unknown };
  if (typed.type === 'text' || typed.type === 'reasoning') {
    return typed.text?.length ?? 0;
  }
  if (typed.type === 'tool-result') {
    return getToolResultText(typed.output)?.length ?? 0;
  }
  return 0;
}

function countMessageTextChars(message: ModelMessage): number {
  if (typeof message.content === 'string') {
    return message.content.length;
  }
  if (!Array.isArray(message.content)) {
    return 0;
  }
  return message.content.reduce((sum, part) => sum + countPartTextChars(part), 0);
}

interface TruncationCandidate {
  length: number;
  get(): string;
  set(value: string): void;
}

function cloneToolResultPart(part: ToolResultPart): ToolResultPart {
  if (typeof part.output === 'object' && part.output != null) {
    return { ...part, output: { ...part.output } };
  }
  return { ...part };
}

function collectTruncationCandidates(messages: ModelMessage[]): TruncationCandidate[] {
  const candidates: TruncationCandidate[] = [];

  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      if (!isToolResultPart(part)) {
        continue;
      }
      const text = getToolResultText(part.output);
      if (text == null) {
        continue;
      }
      candidates.push({
        length: text.length,
        get: () => getToolResultText(part.output) ?? '',
        set: (value) => {
          part.output = replaceToolResultText(part.output, value);
        },
      });
    }
  }

  return candidates.sort((left, right) => right.length - left.length);
}

export function enforceTotalTextBudget(
  messages: ModelMessage[],
  maxTotalChars: number,
): ModelMessage[] {
  if (maxTotalChars <= 0) {
    return messages;
  }

  let totalChars = messages.reduce(
    (sum, message) => sum + countMessageTextChars(message),
    0,
  );
  if (totalChars <= maxTotalChars) {
    return messages;
  }

  const next = messages.map((message) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) =>
        isToolResultPart(part) ? cloneToolResultPart(part) : part,
      ),
    };
  });

  const candidates = collectTruncationCandidates(next);
  for (const candidate of candidates) {
    if (totalChars <= maxTotalChars) {
      break;
    }
    let currentLength = candidate.length;
    while (totalChars > maxTotalChars && currentLength > 1) {
      const overflow = totalChars - maxTotalChars;
      const targetLength = Math.max(1, currentLength - overflow);
      const truncated = truncateMiddle(candidate.get(), targetLength);
      if (truncated.length >= currentLength) {
        break;
      }
      totalChars -= currentLength - truncated.length;
      candidate.set(truncated);
      candidate.length = truncated.length;
      currentLength = truncated.length;
    }
  }

  if (totalChars > maxTotalChars) {
    return progressiveClearWithinCallToolResults(next, maxTotalChars);
  }

  return next;
}

const WITHIN_CALL_PRUNE_FRACTIONS = [0.25, 0.5, 0.75, 1] as const;

/** Goose-style: clear middle compactable tool outputs when truncation is insufficient. */
function progressiveClearWithinCallToolResults(
  messages: ModelMessage[],
  maxTotalChars: number,
): ModelMessage[] {
  for (const fraction of WITHIN_CALL_PRUNE_FRACTIONS) {
    const compactableIds: string[] = [];
    for (const message of messages) {
      if (message.role !== 'tool' || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (!isToolResultPart(part)) continue;
        if (MICROCOMPACTABLE_TOOLS.has(part.toolName)) {
          compactableIds.push(part.toolCallId);
        }
      }
    }

    const clearCount = Math.floor(compactableIds.length * fraction);
    const start = Math.floor((compactableIds.length - clearCount) / 2);
    const clearSet = new Set(compactableIds.slice(start, start + clearCount));

    const pruned = messages.map((message) => {
      if (message.role !== 'tool' || !Array.isArray(message.content)) {
        return message;
      }
      let changed = false;
      const content = message.content.map((part) => {
        if (!isToolResultPart(part) || !clearSet.has(part.toolCallId)) {
          return part;
        }
        const text = getToolResultText(part.output);
        if (text === CLEARED_WITHIN_CALL_OUTPUT) return part;
        changed = true;
        return {
          ...part,
          output: replaceToolResultText(part.output, CLEARED_WITHIN_CALL_OUTPUT),
        };
      });
      return changed ? { ...message, content } : message;
    });

    const total = pruned.reduce(
      (sum, message) => sum + countMessageTextChars(message),
      0,
    );
    if (total <= maxTotalChars) {
      return pruned;
    }
    messages = pruned;
  }

  return messages;
}

export function sanitizeMessagesForStep(
  messages: ModelMessage[],
  config: {
    maxToolResultChars: number;
    maxTotalTextChars: number;
    outdatedReadInvalidation: boolean;
  },
): ModelMessage[] {
  let next = messages;
  if (config.outdatedReadInvalidation) {
    next = invalidateOutdatedReads(next);
    next = microcompactOldToolResults(next);
  }
  next = truncateToolResults(next, config.maxToolResultChars);
  next = enforceTotalTextBudget(next, config.maxTotalTextChars);
  return next;
}
