import { hasUncommittedChanges } from './git-ops.js';
import { findGitRepo } from './git-repo.js';

/**
 * Whether the workspace contains a meaningful git patch (tracked edits or
 * untracked files). Resolves the repo via findGitRepo.
 */
export async function hasMeaningfulPatch(workspaceDir: string): Promise<boolean> {
  const repo = await findGitRepo(workspaceDir);
  if (!repo) return false;
  return hasUncommittedChanges(repo);
}
