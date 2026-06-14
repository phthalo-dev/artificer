import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Locate a git repository inside the workspace: the workspace root itself, or
 * the first immediate subdirectory that is a repo (the agent typically clones
 * the target repo into a subfolder). Returns undefined if none is found.
 */
export async function findGitRepo(
  workspaceDir: string,
): Promise<string | undefined> {
  const hasGit = async (dir: string) =>
    fs
      .access(path.join(dir, '.git'))
      .then(() => true)
      .catch(() => false);

  if (await hasGit(workspaceDir)) return workspaceDir;
  try {
    const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(workspaceDir, entry.name);
      if (await hasGit(sub)) return sub;
    }
  } catch {
    // workspace may not exist yet
  }
  return undefined;
}
