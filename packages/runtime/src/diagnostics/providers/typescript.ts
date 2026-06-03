import fs from 'node:fs/promises';
import path from 'node:path';
import { tscParser } from '../parsers.js';
import type { Diagnostic, LanguageProvider } from '../types.js';

const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** Walk up from a file to find the nearest directory containing tsconfig.json. */
async function findTsconfigDir(
  workspaceDir: string,
  relFile: string,
): Promise<string | undefined> {
  let dir = path.dirname(path.resolve(workspaceDir, relFile));
  const root = path.resolve(workspaceDir);
  while (dir.startsWith(root)) {
    try {
      await fs.access(path.join(dir, 'tsconfig.json'));
      return dir;
    } catch {
      // keep walking up
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * TypeScript checker. `tsc --noEmit` is project-wide and comparatively slow, so
 * this provider is gated by config (DiagnosticsConfig.typescript). It runs once
 * per project containing an edited file and filters output to those files.
 */
export const typescriptProvider: LanguageProvider = {
  id: 'typescript',
  matches(file) {
    return EXTENSIONS.has(path.extname(file).toLowerCase());
  },
  async isAvailable(ctx) {
    if (!(await ctx.which('tsc')) && !(await ctx.which('npx'))) return false;
    for (const file of ctx.files) {
      if (await findTsconfigDir(ctx.workspaceDir, file)) return true;
    }
    return false;
  },
  async diagnose(ctx): Promise<Diagnostic[]> {
    const useNpx = !(await ctx.which('tsc'));
    const bin = useNpx ? 'npx tsc' : 'tsc';

    // Group edited files by their owning tsconfig project to avoid re-running.
    const projects = new Map<string, string[]>();
    for (const file of ctx.files) {
      const dir = await findTsconfigDir(ctx.workspaceDir, file);
      if (!dir) continue;
      const list = projects.get(dir) ?? [];
      list.push(file);
      projects.set(dir, list);
    }

    const diagnostics: Diagnostic[] = [];
    for (const [dir] of projects) {
      const result = await ctx.exec(
        `${bin} --noEmit --pretty false -p ${JSON.stringify('tsconfig.json')}`,
        { cwd: dir },
      );
      for (const diag of tscParser(result)) {
        // tsc paths are relative to the project dir; resolve for filtering.
        diagnostics.push({
          ...diag,
          file: path.resolve(dir, diag.file),
        });
      }
    }
    return diagnostics;
  },
};
