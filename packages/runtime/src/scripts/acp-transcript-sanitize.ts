export interface TranscriptPaths {
  cwd: string;
  parent: string;
  home: string;
}

/**
 * Replace the workspace, its parent, and the home directory with
 * {{WS}} / {{PARENT}} / {{HOME}}. Longer paths go first so a path nested in
 * another is not half-rewritten.
 */
export function sanitizeTranscriptPaths(
  text: string,
  paths: TranscriptPaths,
): string {
  const pairs: Array<[string, string]> = [
    [paths.cwd, '{{WS}}'],
    [paths.parent, '{{PARENT}}'],
    [paths.home, '{{HOME}}'],
  ];
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [from, to] of pairs) {
    if (from && from !== '/') out = out.split(from).join(to);
  }
  return out;
}
