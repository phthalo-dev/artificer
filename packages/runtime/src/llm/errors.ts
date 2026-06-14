import { APICallError } from 'ai';

const BALANCE_PATTERNS = [
  /\binsufficient\s+balance\b/i,
  /\binsufficient\s+account\s+balance\b/i,
  /\binsufficient_balance\b/i,
  /\bpayment\s+required\b/i,
];

/** Collect every string we might match against for balance-related failures. */
function errorTexts(error: unknown): string[] {
  const texts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) texts.push(value);
  };

  push(error);
  if (error instanceof Error) {
    push(error.message);
    if (error.cause) errorTexts(error.cause).forEach((t) => texts.push(t));
  }

  if (APICallError.isInstance(error)) {
    if (error.statusCode === 402) return texts.length > 0 ? texts : ['402'];
    push(error.responseBody);
  }

  return texts;
}

function matchesBalancePattern(text: string): boolean {
  return BALANCE_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when an LLM gateway rejected the call for insufficient balance/credits. */
export function isInsufficientBalanceError(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.statusCode === 402) {
    return true;
  }

  return errorTexts(error).some(matchesBalancePattern);
}

/** Normalize an LLM failure for persistence on a run record. */
export function formatCallError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const parts = [error.message];
    if (error.statusCode) parts.push(`HTTP ${error.statusCode}`);
    if (
      error.responseBody &&
      !error.message.includes(error.responseBody.slice(0, 80))
    ) {
      parts.push(error.responseBody);
    }
    return parts.filter(Boolean).join(' — ');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface InsufficientBalanceMessageOptions {
  model?: string;
  workstreamTitle?: string;
}

/** User-facing explanation when billing blocks further LLM calls. */
export function insufficientBalanceUserMessage(
  opts: InsufficientBalanceMessageOptions = {},
): string {
  const model = opts.model ? ` (model: ${opts.model})` : '';
  const workstream = opts.workstreamTitle
    ? ` Workstream "${opts.workstreamTitle}" is paused until billing is resolved.`
    : '';
  return (
    `I couldn't complete an LLM call because the API reported insufficient balance${model}. ` +
    `If you're using OpenCode Zen, add credits at https://opencode.ai or switch to a model with available quota.${workstream} ` +
    `Send another message when you're ready to continue.`
  );
}
