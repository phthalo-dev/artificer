import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunRecord } from '../storage/types.js';
import type {
  ExecutorReview,
  ExecutorResult,
  WorkerExecutor,
} from './executor.js';
import type { WorkerStatus } from './worker-report.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const MCP_SERVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);
const MCP_SERVER_ID = 'artificer-status';

/**
 * Shell commands the opencode sandbox may run, as opencode `bash` permission
 * patterns. Everything not listed here is denied by the leading `'*': 'deny'`.
 *
 * Matching semantics (opencode `Wildcard.match`, verified against opencode
 * 1.17.3): the shell tool tree-sitter-parses the command string and asks for
 * permission once per parsed command node, using that node's source text as
 * the pattern to match. So `a && b`, `a | b` and `a; b` are checked as two
 * separate commands, and a pattern of `'git status *'` compiles to
 * /^git status( .*)?$/s — it matches both `git status` and
 * `git status --short`, but not `git stash`.
 *
 * Deliberately absent: `git push` (see the origin-removal in `execute()`),
 * `git remote` (could re-add a push target), `curl`, `wget`, `ssh`, `scp`,
 * `rsync`, `nc`, `sudo`, and bare `sh`/`bash`/`zsh -c`.
 */
const BASH_ALLOW: Record<string, 'allow'> = Object.fromEntries(
  [
    // --- inspect / read / search -------------------------------------
    'ls *',
    'cat *',
    'head *',
    'tail *',
    'wc *',
    'file *',
    'stat *',
    'find *',
    'tree *',
    'du *',
    'pwd *',
    'which *',
    'echo *',
    'printf *',
    'basename *',
    'dirname *',
    'realpath *',
    'sort *',
    'uniq *',
    'cut *',
    'tr *',
    'diff *',
    'date *',
    'env *',
    'true *',
    'false *',
    'grep *',
    'rg *',
    'fd *',
    'jq *',
    // --- workspace file manipulation ---------------------------------
    // `mkdir/touch/cp/mv/rm/cat` are in opencode's own FILES set, so their
    // path arguments additionally go through the `external_directory` check
    // below before the command runs.
    'mkdir *',
    'touch *',
    'cp *',
    'mv *',
    'rm *',
    // --- git, local operations only ----------------------------------
    'git status *',
    'git diff *',
    'git log *',
    'git show *',
    'git add *',
    'git commit *',
    'git checkout *',
    'git switch *',
    'git branch *',
    'git restore *',
    'git reset *',
    'git stash *',
    'git rev-parse *',
    'git ls-files *',
    'git config *',
    'git init *',
    'git apply *',
    'git merge *',
    'git rebase *',
    'git tag *',
    'git blame *',
    'git cherry-pick *',
    'git clean *',
    'git describe *',
    'git symbolic-ref *',
    'git fetch *',
    'git worktree *',
    // --- build / test toolchains -------------------------------------
    'node *',
    'npm *',
    'npx *',
    'pnpm *',
    'yarn *',
    'bun *',
    'bunx *',
    'tsc *',
    'tsx *',
    'vitest *',
    'jest *',
    'eslint *',
    'prettier *',
    'python *',
    'python3 *',
    'pip *',
    'pip3 *',
    'pytest *',
    'go *',
    'cargo *',
    'rustc *',
    'make *',
    'ruby *',
    'rake *',
    'bundle *',
    'mvn *',
    'gradle *',
    'dotnet *',
    'swift *',
    'deno *',
  ].map((pattern) => [pattern, 'allow'] as const),
);

/**
 * The opencode permission config written into the sandbox workspace, replacing
 * the `--dangerously-skip-permissions` flag this executor used to pass.
 *
 * Key order is load-bearing: opencode flattens the config into a rule list in
 * object-key order and resolves a request with `findLast`, so a later rule wins
 * over an earlier one. `external_directory: 'deny'` is therefore last.
 *
 * There is deliberately **no `'*'` wildcard entry** here. opencode's own
 * built-in agent defaults already start with `'*': 'allow'` and place this
 * config's rules after them, so listing every category we need explicitly costs
 * nothing and removes the "a user's global config positions its own rule after
 * our wildcard" ordering hazard entirely.
 *
 * Precedence guarantee, tested empirically against opencode 1.17.3 on
 * 2026-08-17 (see .superpowers/sdd/2026-08-14-opencode-executor/
 * task-fixwave-report.md): opencode merges the user's global config first and
 * this project-level config last (`remeda.mergeDeep`), so for a category key
 * that appears in both, *our value wins* — but the merged key keeps the
 * global config's *position*. We therefore have no defense against a global
 * config that declares `external_directory` (any value) and then `'*'` after
 * it: that would hoist our deny above the user's wildcard allow. That is a
 * configuration a user has to write on their own machine deliberately; it is
 * not reachable from inside the sandbox.
 *
 * What this config actually buys, stated honestly:
 *   - It closes the Task 4 failure mode: opencode reading an absolute path out
 *     of its prompt and editing/writing files there via the path-bearing tools
 *     (read/write/edit/glob/grep/list/lsp), which all consult
 *     `external_directory`.
 *   - It closes opportunistic shell misuse: `git push`, `curl`, `scp`, `ssh`,
 *     and arbitrary unlisted binaries are denied outright.
 *   - It does **not** make sandbox escape impossible, and this is demonstrated,
 *     not theoretical. opencode's own bash tool documents its
 *     command-argument path scan as "advisory only". Shell redirection targets
 *     are not path-checked at all: `echo LEAK > /outside/the/workspace` matches
 *     the `echo *` pattern and was confirmed on 2026-08-17 to write outside
 *     `--dir`. Every entry in this allow-list ends in `*`, so every one of them
 *     can carry a redirection. More fundamentally, running a project's tests at
 *     all means allowing `node`/`python`/`npm run`, which is arbitrary code
 *     execution by definition — a determined or prompt-injected agent can write
 *     a script inside the workspace and run it. Real containment needs
 *     OS-level sandboxing, which this executor does not provide.
 */
function permissionConfig(): Record<string, unknown> {
  return {
    // Mirrors opencode's built-in read rule so the `.env` carve-out survives.
    read: {
      '*': 'allow',
      '*.env': 'ask',
      '*.env.*': 'ask',
      '*.env.example': 'allow',
    },
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    task: 'allow',
    todowrite: 'allow',
    bash: { '*': 'deny', ...BASH_ALLOW },
    [`${MCP_SERVER_ID}_report_status`]: 'allow',
    [`${MCP_SERVER_ID}_submit_review`]: 'allow',
    // Must stay last — see the key-order note above.
    external_directory: 'deny',
  };
}

/**
 * Defense in depth for the bash vector: `cloneRepoIntoWorkspace` clones the
 * real repo into `{workspaceDir}/repo`, which leaves `origin` pointing at it.
 * `external_directory` never sees bash arguments, so `git push origin HEAD`
 * from inside the sandbox would write back to the original repo without any
 * absolute path appearing in the command. Drop the remote before opencode
 * starts. No-op when the workspace has no git clone (e.g. smoke tests) or no
 * `origin`.
 */
function removeOriginRemote(workspaceDir: string): void {
  const repoDir = path.join(workspaceDir, 'repo');
  if (!fs.existsSync(path.join(repoDir, '.git'))) return;
  try {
    execFileSync('git', ['-C', repoDir, 'remote', 'remove', 'origin'], {
      stdio: 'ignore',
    });
  } catch {
    /* no origin configured — nothing to remove */
  }
}

export class OpencodeExecutor implements WorkerExecutor {
  readonly name = 'opencode';

  constructor(private readonly model?: string) {}

  execute({
    context,
    workspaceDir,
  }: {
    context: string;
    workspaceDir: string;
    run: RunRecord;
  }): Promise<ExecutorResult> {
    const statusFile = path.join(workspaceDir, '.artificer-status.json');
    // opencode discovers MCP servers from a project-level opencode.json
    // (walking up from cwd) — there is no --mcp-config flag, so this must
    // live at the workspace root under opencode's own config file name.
    const mcpConfigFile = path.join(workspaceDir, 'opencode.json');

    fs.writeFileSync(
      mcpConfigFile,
      JSON.stringify({
        mcp: {
          [MCP_SERVER_ID]: {
            type: 'local',
            command: [process.execPath, MCP_SERVER, statusFile],
            enabled: true,
          },
        },
        // Explicit allow-list instead of --dangerously-skip-permissions,
        // which blanket-bypasses opencode's own guards. See
        // permissionConfig() above for what this does and does not close.
        permission: permissionConfig(),
      }),
    );

    // Clean up any status file from a previous run
    fs.rmSync(statusFile, { force: true });

    removeOriginRemote(workspaceDir);

    return new Promise((resolve, reject) => {
      const args = ['run', context, '--dir', workspaceDir];
      if (this.model) args.push('--model', this.model);

      const child = spawn('opencode', args, {
        cwd: workspaceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('opencode agent timed out'));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
        const text = Buffer.concat(stdout).toString('utf-8').trim();

        // Read MCP-reported tool result if a tool was called
        let workerStatus: WorkerStatus | undefined;
        let workerSummary: string | undefined;
        let workerFollowUps: string | undefined;
        let review: ExecutorReview | undefined;
        try {
          if (fs.existsSync(statusFile)) {
            const raw = JSON.parse(
              fs.readFileSync(statusFile, 'utf-8'),
            ) as Record<string, unknown>;
            if (raw.tool === 'submit_review') {
              review = {
                target: String(raw.target ?? 'work'),
                notes: String(raw.notes ?? ''),
                approved: Boolean(raw.approved),
                stage: (raw.stage as 'plan' | 'work' | undefined) ?? 'work',
                severity: raw.severity as
                  | ExecutorReview['severity']
                  | undefined,
              };
            } else {
              workerStatus = raw.status as WorkerStatus | undefined;
              workerSummary = raw.summary as string | undefined;
              workerFollowUps = raw.followUps as string | undefined;
            }
          }
        } catch {
          /* ignore malformed status file */
        }

        if (code !== 0) {
          const errText = Buffer.concat(stderr).toString('utf-8').trim();
          reject(
            new Error(
              `opencode agent exited with code ${code}: ${errText || text}`,
            ),
          );
        } else {
          resolve({
            text: text || '(no output)',
            usage: { inputTokens: 0, outputTokens: 0 },
            workerStatus,
            workerSummary,
            workerFollowUps,
            review,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
