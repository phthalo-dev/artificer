import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildProviders, providerFor } from './registry.js';
import type {
  Diagnostic,
  DiagnoseContext,
  DiagnosticsConfig,
  ExecResult,
  LanguageProvider,
} from './types.js';

const execAsync = promisify(exec);

/** Build an exec/which surface bound to a workspace and environment. */
export function makeExec(
  workspaceDir: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Pick<DiagnoseContext, 'exec' | 'which'> {
  async function run(command: string, cwd: string): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        env,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 10,
      });
      return { stdout, stderr, code: 0 };
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? e.message ?? '',
        code: typeof e.code === 'number' ? e.code : 1,
      };
    }
  }

  return {
    exec(command, opts) {
      const cwd = opts?.cwd ?? workspaceDir;
      return run(command, cwd);
    },
    async which(binary) {
      const result = await run(`command -v ${binary}`, workspaceDir);
      return result.code === 0 && result.stdout.trim().length > 0;
    },
  };
}

/** Does a reported diagnostic path refer to one of the edited files? */
function matchesEditedFile(
  diagFile: string,
  workspaceDir: string,
  editedAbs: string[],
): boolean {
  if (!diagFile) return true; // location-less diagnostics (e.g. syntax errors)
  const abs = path.isAbsolute(diagFile)
    ? path.resolve(diagFile)
    : path.resolve(workspaceDir, diagFile);
  return editedAbs.includes(abs);
}

function formatBlock(source: string, diagnostics: Diagnostic[]): string {
  const lines = diagnostics.map((d) => {
    const loc =
      d.line != null
        ? `:${d.line}${d.column != null ? `:${d.column}` : ''}`
        : '';
    const where = d.file ? `${d.file}${loc} ` : '';
    return `${where}${d.severity}: ${d.message}`;
  });
  return `Diagnostics (${source}) — fix these before finishing:\n${lines.join('\n')}`;
}

/**
 * Run the relevant checker for each edited file and return a compact, model
 * facing block of errors — or an empty string if there is nothing to report
 * (diagnostics disabled, no provider, toolchain absent, or no errors).
 *
 * Failures are swallowed: a broken checker must never break an edit.
 */
export async function runDiagnostics(
  config: DiagnosticsConfig,
  base: Pick<DiagnoseContext, 'workspaceDir' | 'env' | 'files'> & {
    exec?: DiagnoseContext['exec'];
    which?: DiagnoseContext['which'];
  },
): Promise<string> {
  if (!config.enabled || base.files.length === 0) return '';

  const providers = buildProviders(config);
  const surface =
    base.exec && base.which
      ? { exec: base.exec, which: base.which }
      : makeExec(base.workspaceDir, base.env, config.timeoutMs);

  // Group edited files by the provider that handles them.
  const byProvider = new Map<LanguageProvider, string[]>();
  for (const file of base.files) {
    const provider = providerFor(providers, file);
    if (!provider) continue;
    const list = byProvider.get(provider) ?? [];
    list.push(file);
    byProvider.set(provider, list);
  }

  const editedAbs = base.files.map((f) => path.resolve(base.workspaceDir, f));
  const blocks: string[] = [];

  for (const [provider, files] of byProvider) {
    const ctx: DiagnoseContext = {
      workspaceDir: base.workspaceDir,
      env: base.env,
      files,
      timeoutMs: config.timeoutMs,
      ...surface,
    };
    try {
      if (!(await provider.isAvailable(ctx))) continue;
      const all = await provider.diagnose(ctx);
      const errors = all
        .filter((d) => d.severity === 'error')
        .filter((d) => matchesEditedFile(d.file, base.workspaceDir, editedAbs))
        .slice(0, config.maxPerFile);
      if (errors.length > 0) blocks.push(formatBlock(provider.id, errors));
    } catch {
      // A misbehaving checker should never surface as an edit failure.
    }
  }

  return blocks.join('\n\n');
}
