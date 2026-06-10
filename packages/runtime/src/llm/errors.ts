import { APICallError } from 'ai';

const CONTEXT_LENGTH_PATTERNS = [
  /\bcontext\s*length\b/i,
  /\bmaximum\s+context\b/i,
  /\btoo\s+many\s+tokens\b/i,
  /\binput\s+is\s+too\s+long\b/i,
  /\bprompt\s+is\s+too\s+long\b/i,
  /\bcontext\s+window\b/i,
  /\btoken\s+limit\b/i,
  /\bexceeds?\s+the\s+(?:model\s+)?(?:context|token)\s+limit\b/i,
  /\brequest\s+too\s+large\b/i,
];

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

function matchesContextLengthPattern(text: string): boolean {
  return CONTEXT_LENGTH_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when the provider rejected the call because the prompt exceeded context limits. */
export function isContextLengthError(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.statusCode === 413) {
    return true;
  }
  return errorTexts(error).some(matchesContextLengthPattern);
}

/** True when an LLM gateway rejected the call for insufficient balance/credits. */
export function isInsufficientBalanceError(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.statusCode === 402) {
    return true;
  }

  return errorTexts(error).some(matchesBalancePattern);
}

export class CallAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallAbortedError';
  }
}

/** Normalize an LLM failure for persistence on a run record. */
export function formatCallError(error: unknown): string {
  if (error instanceof CallAbortedError) return error.message;
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
