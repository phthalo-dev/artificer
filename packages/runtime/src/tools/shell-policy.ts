import path from 'node:path';
import type { RoleName } from '../storage/types.js';

export interface ShellPolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Split a shell command on `&&`, `||`, `;`, and `|` while keeping it simple
 * enough for git-clone checks (not a full shell parser).
 */
function splitCommandSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extract non-flag arguments from a `git clone …` segment. */
function gitCloneArgs(segment: string): string[] | null {
  if (!/\bgit\s+clone\b/i.test(segment)) return null;
  const tokens = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const args: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i].replace(/^['"]|['"]$/g, '');
    if (tok === 'git') continue;
    if (tok.startsWith('-')) continue;
    args.push(tok);
  }
  return args.length >= 2 ? args : null;
}

function isAbsoluteOutsideWorkspace(
  target: string,
  workspaceDir: string,
  cwd: string,
): boolean {
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(cwd, target);
  const rel = path.relative(workspaceDir, resolved);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

/**
 * Reject `git clone` targets that resolve outside the workstream workspace.
 * Allows `git clone URL .`, `git clone URL repo`, and workspace-relative paths.
 * Tracks `cd` across chained commands (`&&`, `||`, `;`, `|`).
 */
export function checkGitCloneInWorkspace(
  command: string,
  cwd: string,
  workspaceDir: string,
): ShellPolicyResult {
  let effectiveCwd = cwd;
  for (const segment of splitCommandSegments(command)) {
    const cdMatch = segment.match(/^\s*cd\s+(.+?)\s*$/);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^['"]|['"]$/g, '');
      effectiveCwd =
        target === '.'
          ? effectiveCwd
          : path.isAbsolute(target)
            ? path.resolve(target)
            : path.resolve(effectiveCwd, target);
      continue;
    }

    const args = gitCloneArgs(segment);
    if (!args) continue;
    const target = args[args.length - 1];
    if (target === '.') {
      if (isAbsoluteOutsideWorkspace('.', workspaceDir, effectiveCwd)) {
        return {
          allowed: false,
          reason:
            'Clone into a workspace subdirectory, e.g. `git clone URL repo` — not /tmp or other paths outside the workspace.',
        };
      }
      continue;
    }
    if (isAbsoluteOutsideWorkspace(target, workspaceDir, effectiveCwd)) {
      return {
        allowed: false,
        reason:
          'Clone into a workspace subdirectory, e.g. `git clone URL repo` — not /tmp or other paths outside the workspace.',
      };
    }
  }
  return { allowed: true };
}

/**
 * Detect whether a single command segment would mutate the workspace. Returns a
 * short label for the offending operation, or undefined if the segment is
 * read-only. Read commands that merely redirect to /dev/null or dup file
 * descriptors (`2>/dev/null`, `>&2`) are allowed.
 */
function detectMutation(segment: string): string | undefined {
  const s = segment.trim();

  // In-place stream editors.
  if (/\bsed\s+(?:-\S+\s+)*-i/.test(s)) return 'sed -i (in-place edit)';
  if (/\bperl\s+(?:-\S+\s+)*-i/.test(s)) return 'perl -i (in-place edit)';

  // Applying patches.
  if (/^patch\b/.test(s) || /\bpatch\s+-p\d/.test(s)) return 'patch';

  // Destructive git operations (diff/show/log/status are read-only).
  const git = s.match(
    /\bgit\s+(checkout|reset|apply|restore|commit|stash|rm|mv|clean)\b/,
  );
  if (git) return `git ${git[1]}`;

  // Filesystem mutators invoked directly (segment-leading after pipe/&&/;).
  const lead = s.match(/^(rm|mv|tee|truncate|dd|install)\b/);
  if (lead) return lead[1];

  // Output redirection to a real file (strip quoted strings first so `>` inside
  // an awk/python/sed program is not mistaken for a redirect).
  const unquoted = s.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  const redir = unquoted.match(/\d*>>?\s*(\S+)/);
  if (redir) {
    const target = redir[1];
    const benign = target.startsWith('&') || target.startsWith('/dev/');
    if (!benign) return 'output redirection';
  }

  return undefined;
}

/**
 * The reviewer is read-only: it verifies, it does not change the workspace.
 * Its tool registry already withholds `write_file`/`edit_file`, but `run_shell`
 * could otherwise mutate files (`sed -i`, `patch`, `git checkout`, redirects).
 * This guard closes that gap. No-op for every other role.
 */
export function checkReviewerWrite(
  command: string,
  role: RoleName,
): ShellPolicyResult {
  if (role !== 'reviewer') return { allowed: true };
  for (const segment of splitCommandSegments(command)) {
    const mutation = detectMutation(segment);
    if (mutation) {
      return {
        allowed: false,
        reason: `The reviewer is read-only: \`${mutation}\` would modify the workspace. Record an issue in your review instead of editing files.`,
      };
    }
  }
  return { allowed: true };
}
