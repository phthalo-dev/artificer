import type { ToolContext } from '../context.js';
import { runDiagnostics } from '../diagnostics/index.js';
import { buildGitEnv } from './git-env.js';

/**
 * Run post-edit diagnostics for the given workspace-relative files and return a
 * message suffix (a leading blank line plus the errors) to append to a tool
 * result, or an empty string when there is nothing to report.
 */
export async function diagnoseEdited(
  ctx: ToolContext,
  files: string[],
): Promise<string> {
  const config = ctx.engine.config.diagnostics;
  if (!config?.enabled) return '';
  const env = buildGitEnv(
    ctx.engine.config.github,
    process.env,
    ctx.workspaceDir,
  );
  const report = await runDiagnostics(config, {
    workspaceDir: ctx.workspaceDir,
    env,
    files,
  });
  return report ? `\n\n${report}` : '';
}
