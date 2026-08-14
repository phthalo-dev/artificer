import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface PatchResult {
  patch: string;
  /** Absolute path to the git repo the patch was extracted from. */
  repoDir?: string;
  /** Set when extraction could not produce a meaningful diff. */
  warning?: string;
}

/** Runs git in a repo, returning stdout (trimmed of nothing). */
async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', repoDir, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Finds every git working tree under `root` (BFS, shallow). A capable agent
 * clones once into the workspace, but a confused one may leave several clones
 * (including nested ones), so we collect them all and pick the best later.
 */
async function findGitRepos(root: string, maxDepth = 3): Promise<string[]> {
  const found: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (await isDir(path.join(dir, '.git'))) found.push(dir);
    if (depth >= maxDepth) continue;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git') continue;
      const child = path.join(dir, name);
      // Descend even into a found repo so nested clones are discovered too.
      if (await isDir(child)) queue.push({ dir: child, depth: depth + 1 });
    }
  }
  return found;
}

/**
 * Drops submodule/gitlink sections from a unified diff. When the agent leaves
 * nested clones inside another repo, the parent's diff records them only as
 * `Subproject commit` / mode 160000 gitlinks, which are never the real change.
 */
function stripGitlinks(patch: string): string {
  if (!patch) return patch;
  const sections = patch.split(/(?=^diff --git )/m);
  return sections
    .filter((s) => s && !/Subproject commit|mode 160000/.test(s))
    .join('');
}

/** Basenames of files the agent creates as scratch, never part of a real fix. */
const SCRATCH_NEW_FILE = [
  /^reproduce.*\.py$/i,
  /^run_tests?.*\.py$/i,
  /^test_.*\.py$/i, // ad-hoc test/repro scripts (bench forbids adding tests)
];

/** The `b/...` path of a diff section. */
function sectionPath(section: string): string | undefined {
  const m = section.match(/^diff --git a\/\S+ b\/(\S+)/m);
  return m?.[1];
}

/**
 * Drops diff sections for newly-created scratch files (repro scripts, ad-hoc
 * test runners, added test files). Only *new* files are stripped — modifications
 * to files that existed at the base commit are real changes and kept. This stops
 * the agent's debugging scaffolding from inflating (or becoming) the patch.
 */
export function stripScratchFiles(patch: string): string {
  if (!patch) return patch;
  const sections = patch.split(/(?=^diff --git )/m);
  return sections
    .filter((s) => {
      if (!s) return false;
      const isNewFile = /^new file mode /m.test(s);
      if (!isNewFile) return true;
      const p = sectionPath(s);
      if (!p) return true;
      const base = p.split('/').pop() ?? p;
      return !SCRATCH_NEW_FILE.some((re) => re.test(base));
    })
    .join('');
}

const PATCH_WARN_BYTES = 256 * 1024;
const PATCH_FLAG_BYTES = 1024 * 1024;

/**
 * A warning when a patch is suspiciously large. We never truncate — a real
 * (if large) fix must still be gradable — but a multi-hundred-KB or multi-MB
 * diff almost always means the agent staged the whole repo or scratch output.
 */
export function patchSizeWarning(bytes: number): string | undefined {
  if (bytes > PATCH_FLAG_BYTES) {
    return `patch is unusually large (${(bytes / 1024 / 1024).toFixed(1)}MB); likely the whole repo or scratch output was staged rather than a focused fix`;
  }
  if (bytes > PATCH_WARN_BYTES) {
    return `patch is large (${Math.round(bytes / 1024)}KB); verify it contains only the intended change`;
  }
  return undefined;
}

/** Number of real changed content lines in a diff (ignores headers). */
function diffWeight(patch: string): number {
  let n = 0;
  for (const line of patch.split('\n')) {
    if (/^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) n += 1;
  }
  return n;
}

/**
 * Extracts the agent's changes as a unified diff against `baseCommit`.
 *
 * Strategy: stage everything (so new/untracked files are included), then diff
 * the index against the base commit. This captures committed and uncommitted
 * work alike. If the base commit isn't known locally (e.g. a shallow clone),
 * we try to fetch it; failing that we fall back to diffing against the repo's
 * first commit-ish and record a warning.
 */
async function diffRepo(
  repoDir: string,
  baseCommit: string,
): Promise<{ patch: string; baseKnown: boolean }> {
  // Stage all changes (including untracked) without touching commits.
  await git(repoDir, ['add', '-A']).catch(() => undefined);

  const knows = (): Promise<boolean> =>
    git(repoDir, ['cat-file', '-e', `${baseCommit}^{commit}`])
      .then(() => true)
      .catch(() => false);

  if (!(await knows())) {
    await git(repoDir, ['fetch', '--depth', '1', 'origin', baseCommit]).catch(
      () => undefined,
    );
  }
  const baseKnown = await knows();

  const args = baseKnown
    ? ['diff', '--cached', '--no-color', baseCommit]
    : ['diff', '--cached', '--no-color'];
  const raw = await git(repoDir, args).catch(() => '');
  return { patch: stripScratchFiles(stripGitlinks(raw)), baseKnown };
}

/**
 * Extracts the agent's changes as a unified diff against `baseCommit`.
 *
 * For each git working tree in the workspace we stage everything (so new and
 * untracked files count) and diff the index against the base commit, dropping
 * submodule/gitlink noise. The repo with the most substantive real change wins
 * — this is robust to a single clean clone as well as to a confused agent that
 * scattered several clones around the workspace. Base commits missing locally
 * are fetched; if that fails we fall back to diffing against HEAD and warn.
 */
export async function extractPatch(
  workspaceDir: string,
  baseCommit: string,
): Promise<PatchResult> {
  const repos = await findGitRepos(workspaceDir);
  if (repos.length === 0) {
    return { patch: '', warning: 'no git repository found in workspace' };
  }

  let best: { patch: string; repoDir: string; baseKnown: boolean } | undefined;
  for (const repoDir of repos) {
    const { patch, baseKnown } = await diffRepo(repoDir, baseCommit);
    if (!patch) continue;
    // Prefer a repo that knows the base commit; then the largest real diff.
    const better =
      !best ||
      (baseKnown && !best.baseKnown) ||
      (baseKnown === best.baseKnown &&
        diffWeight(patch) > diffWeight(best.patch));
    if (better) best = { patch, repoDir, baseKnown };
  }

  if (!best) {
    return {
      patch: '',
      repoDir: repos[0],
      warning: `found ${repos.length} repo(s) but none had extractable changes`,
    };
  }

  const warnings = [
    best.baseKnown
      ? undefined
      : `base commit ${baseCommit.slice(0, 12)} not present locally; diffed against HEAD instead`,
    patchSizeWarning(Buffer.byteLength(best.patch, 'utf8')),
  ].filter(Boolean);

  return {
    patch: best.patch,
    repoDir: best.repoDir,
    warning: warnings.length > 0 ? warnings.join('; ') : undefined,
  };
}
