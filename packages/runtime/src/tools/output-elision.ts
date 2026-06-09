/** Threshold above which tool output is head/tail elided (mini-swe-agent style). */
export const ELISION_THRESHOLD = 10_000;
const HEAD_CHARS = 5_000;
const TAIL_CHARS = 5_000;

/**
 * Formats long command output as head + elision notice + tail so models still
 * see boundaries without blowing the context window.
 */
export function elideOutput(text: string): string {
  if (text.length <= ELISION_THRESHOLD) return text;
  const elided = text.length - HEAD_CHARS - TAIL_CHARS;
  return [
    text.slice(0, HEAD_CHARS),
    '',
    `[... ${elided} characters elided — output was too long. Use head, tail, sed, or grep for selective views, or redirect to a file and search it.]`,
    '',
    text.slice(-TAIL_CHARS),
  ].join('\n');
}
