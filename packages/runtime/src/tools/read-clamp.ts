/** Default number of lines read_file returns when no limit is given. */
export const DEFAULT_READ_LINES = 500;

/**
 * Clamp file content to a line window so a single read_file of a huge file
 * (e.g. a 50k-line bundle) cannot blow the context budget or stall the call.
 * Returns the whole file unchanged when it already fits; otherwise returns the
 * requested window plus a note pointing at offset/limit and grep.
 */
export function clampFileContent(
  content: string,
  opts?: { offset?: number; limit?: number },
): string {
  const lines = content.split('\n');
  const total = lines.length;
  const start = Math.max(1, Math.trunc(opts?.offset ?? 1));
  const limit = Math.max(1, Math.trunc(opts?.limit ?? DEFAULT_READ_LINES));
  const end = Math.min(total, start - 1 + limit);

  if (start === 1 && end >= total) return content;

  const slice = lines.slice(start - 1, end).join('\n');
  const note = `\n\n[read_file: showing lines ${start}-${end} of ${total}. Use offset/limit to read another window, or grep to find specific content.]`;
  return slice + note;
}
