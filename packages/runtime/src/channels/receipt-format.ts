import type { MessageChannelContext } from '../storage/types.js';
import type { WorkstreamReceipt } from '../engine/workstream-receipt.js';

const SLACK_MAX = 3_500;

function statusEmoji(status: WorkstreamReceipt['status']): string {
  if (status === 'done') return '✅';
  if (status === 'failed' || status === 'blocked') return '⚠️';
  if (status === 'cancelled') return '🛑';
  return '🔄';
}

function stepProgress(steps: WorkstreamReceipt['steps']): string {
  if (steps.length === 0) return 'No steps recorded';
  const done = steps.filter((step) => step.status === 'done').length;
  return `${done}/${steps.length} steps complete`;
}

function validationLine(validation: WorkstreamReceipt['validation']): string | null {
  if (validation.length === 0) return null;
  const passed = validation.filter((check) => check.status === 'passed').length;
  const failed = validation.filter((check) => check.status === 'failed').length;
  if (failed > 0) return `Validation: ${failed} failed, ${passed} passed`;
  return `Validation: ${passed} passed`;
}

function reviewLine(reviews: WorkstreamReceipt['reviews']): string | null {
  const latest = reviews.at(-1);
  if (!latest) return null;
  return latest.approved
    ? 'Review: approved'
    : 'Review: changes requested';
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function wantsFullReceipt(content: string): boolean {
  return /\bfull\s+receipt\b/i.test(content);
}

export function formatReceiptForChannel(
  receipt: WorkstreamReceipt,
  markdown: string,
  channelContext?: MessageChannelContext,
): string {
  const includeFull =
    channelContext?.includeFullReceipt ||
    wantsFullReceipt(channelContext?.originContent ?? '');
  if (includeFull) {
    return clip(markdown, SLACK_MAX);
  }

  const lines = [
    `${statusEmoji(receipt.status)} *${receipt.title}* — ${receipt.status.replace(/_/g, ' ')}`,
    '',
    receipt.summary || 'No summary available yet.',
    '',
    stepProgress(receipt.steps),
  ];

  if (receipt.changes.files.length > 0) {
    lines.push(`Changes: ${receipt.changes.files.length} file(s)`);
  }
  const validation = validationLine(receipt.validation);
  if (validation) lines.push(validation);
  const review = reviewLine(receipt.reviews);
  if (review) lines.push(review);

  lines.push(
    `Usage: ${receipt.usage.runCount} runs · ${receipt.usage.inputTokens.toLocaleString()} in / ${receipt.usage.outputTokens.toLocaleString()} out tokens`,
  );

  if (receipt.nextAction) {
    lines.push('', `Next: ${receipt.nextAction}`);
  }

  lines.push('', `<${receipt.links.localUrl}|Open in Artificer>`);
  return clip(lines.join('\n'), SLACK_MAX);
}
