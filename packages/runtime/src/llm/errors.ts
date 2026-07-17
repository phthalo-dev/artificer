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

const QUOTA_PATTERNS = [
  /\busage\s+limit\b/i,
  /\bquota\s+exceeded\b/i,
  /\brate\s+limit\b/i,
  /\btoo\s+many\s+requests\b/i,
  /\bover\s+(your\s+)?(usage|quota)\b/i,
];

function matchesQuotaPattern(text: string): boolean {
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text));
}

/** True when a provider rejected the call for a time-window or rate quota. */
export function isQuotaExhaustedError(error: unknown): boolean {
  if (isInsufficientBalanceError(error)) return false;
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    return true;
  }
  return errorTexts(error).some(matchesQuotaPattern);
}

/** Alias for quota-class rate limiting (429 and message heuristics). */
export function isRateLimitError(error: unknown): boolean {
  return isQuotaExhaustedError(error);
}

/** Parse Retry-After style hints from an error message (seconds). */
export function quotaRetryAfterMs(error: unknown): number | undefined {
  const texts = errorTexts(error);
  for (const text of texts) {
    const sec = text.match(/retry[- ]after[:\s]+(\d+)/i);
    if (sec) return Number(sec[1]) * 1000;
    const resets = text.match(
      /resets?\s+in\s+(\d+)\s*(m|min|minutes?|h|hours?|s|sec)/i,
    );
    if (resets) {
      const n = Number(resets[1]);
      const unit = resets[2].toLowerCase();
      if (unit.startsWith('h')) return n * 3_600_000;
      if (unit.startsWith('m')) return n * 60_000;
      return n * 1000;
    }
  }
  return undefined;
}

export interface QuotaPausedMessageOptions {
  workstreamTitle?: string;
  resumesAt?: string;
}

/** User-facing explanation when quota pauses further LLM calls. */
export function quotaPausedUserMessage(
  opts: QuotaPausedMessageOptions = {},
): string {
  const workstream = opts.workstreamTitle
    ? ` Workstream "${opts.workstreamTitle}" is paused until quota resets.`
    : '';
  const when = opts.resumesAt ? ` Resumes around ${opts.resumesAt}.` : '';
  return (
    `I paused work because a usage quota was reached.${when}${workstream} ` +
    `I'll resume automatically when the window opens.`
  );
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
