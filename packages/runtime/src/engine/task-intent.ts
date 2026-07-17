/** Parsed fields from a bench-style `--- WORKSTREAM ---` header block. */
export interface WorkstreamHeader {
  repoUrl?: string;
  baseCommit?: string;
  title?: string;
}

const WORKSTREAM_HEADER_RE = /^---\s*WORKSTREAM\s*---\s*\n([\s\S]*?)\n---\s*$/m;

const HEADER_FIELD_RE = /^(repoUrl|baseCommit|title):\s*(.+)$/;

/**
 * Extract structured workstream fields from a task message header. Returns
 * null when no header block is present.
 */
export function parseWorkstreamHeader(
  content: string,
): WorkstreamHeader | null {
  const match = content.match(WORKSTREAM_HEADER_RE);
  if (!match) return null;

  const header: WorkstreamHeader = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(HEADER_FIELD_RE);
    if (!field) continue;
    const value = field[2].trim();
    if (field[1] === 'repoUrl') header.repoUrl = value;
    else if (field[1] === 'baseCommit') header.baseCommit = value;
    else if (field[1] === 'title') header.title = value;
  }

  return Object.keys(header).length > 0 ? header : null;
}

/** True when inbound text looks like a repo-fix / clone / bench SWE task. */
export function isRepoTaskMessage(content: string): boolean {
  if (parseWorkstreamHeader(content)) return true;

  const lower = content.toLowerCase();
  const signals = [
    /\bclone\b/.test(lower) && /github\.com/.test(lower),
    /\bbase commit\b/.test(lower),
    /check out the exact base commit/.test(lower),
    /setup \(do this first/.test(lower),
    /complete the software engineering task/.test(lower),
    /fix a bug in the github repository/.test(lower),
  ];
  return signals.some(Boolean);
}

/** True when learn material is a GitHub repo URL rather than reference docs. */
export function looksLikeRepoSource(material: string): boolean {
  const trimmed = material.trim();
  if (!/github\.com/i.test(trimmed)) return false;
  // Repo root or tree URLs used as "source code" during implementation work.
  return (
    /github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?(?:\/)?$/i.test(trimmed) ||
    /github\.com\/[^/\s]+\/[^/\s]+\/(tree|blob)\//i.test(trimmed)
  );
}
