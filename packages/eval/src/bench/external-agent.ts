import { type ChildProcess, execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import 'dotenv/config';
import { BENCH_DIR, RESULTS_DIR, resolveSuitePath } from './config.js';
import { extractPatch } from '../driver/extract-patch.js';
import { sandboxGithubEnv } from './git-sandbox.js';
import { buildTaskMessage } from './run-instance.js';
import { loadSuiteInstances, readSuite, suiteKind, suiteName } from './suites.js';
import type { AttemptOutcome, AttemptRecord, BenchInstance, Prediction } from './types.js';

const execFileAsync = promisify(execFile);

/** Parsed from each agent's own JSON output; every field is best-effort. */
interface ParsedUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  // Recorded separately from inputTokens because cache tokens are typically
  // priced very differently (often far cheaper) — folding them together
  // would make future cost recomputation from raw tokens wrong.
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

interface AgentSpec {
  /** Binary name resolved via PATH. */
  command: string;
  /** Builds argv for a single-shot, fully autonomous (no human present) run. */
  buildArgs(prompt: string, model: string | undefined, repoDir: string): string[];
  /** Best-effort extraction of cost/token usage from the CLI's captured stdout. */
  parseUsage(stdout: string): ParsedUsage;
}

const AGENTS: Record<string, AgentSpec> = {
  claude: {
    command: 'claude',
    buildArgs: (prompt, model) => [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
      ...(model ? ['--model', model] : []),
    ],
    parseUsage(stdout) {
      try {
        const j = JSON.parse(stdout.trim());
        return {
          costUsd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : undefined,
          inputTokens: j.usage?.input_tokens,
          outputTokens: j.usage?.output_tokens,
          cacheCreationInputTokens: j.usage?.cache_creation_input_tokens,
          cacheReadInputTokens: j.usage?.cache_read_input_tokens,
        };
      } catch {
        return {};
      }
    },
  },
  cursor: {
    command: 'cursor-agent',
    buildArgs: (prompt, model, repoDir) => [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--force',
      '--trust',
      '--workspace',
      repoDir,
      ...(model ? ['--model', model] : []),
    ],
    parseUsage(stdout) {
      try {
        const j = JSON.parse(stdout.trim());
        return {
          inputTokens: j.usage?.inputTokens,
          outputTokens: j.usage?.outputTokens,
          cacheCreationInputTokens: j.usage?.cacheWriteTokens,
          cacheReadInputTokens: j.usage?.cacheReadTokens,
        };
      } catch {
        return {};
      }
    },
  },
  opencode: {
    command: 'opencode',
    buildArgs: (prompt, model, repoDir) => [
      'run',
      prompt,
      '--dangerously-skip-permissions',
      '--format',
      'json',
      '--dir',
      repoDir,
      ...(model ? ['--model', model] : []),
    ],
    parseUsage(stdout) {
      let costUsd: number | undefined;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationInputTokens = 0;
      let cacheReadInputTokens = 0;
      let sawTokens = false;
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const part = event.part;
          if (part?.type === 'step-finish') {
            if (typeof part.cost === 'number') costUsd = (costUsd ?? 0) + part.cost;
            if (part.tokens) {
              sawTokens = true;
              inputTokens += part.tokens.input ?? 0;
              outputTokens += part.tokens.output ?? 0;
              cacheCreationInputTokens += part.tokens.cache?.write ?? 0;
              cacheReadInputTokens += part.tokens.cache?.read ?? 0;
            }
          }
        } catch {
          // Non-JSON line (shouldn't happen with --format json); skip it.
        }
      }
      return {
        costUsd,
        inputTokens: sawTokens ? inputTokens : undefined,
        outputTokens: sawTokens ? outputTokens : undefined,
        cacheCreationInputTokens: sawTokens ? cacheCreationInputTokens : undefined,
        cacheReadInputTokens: sawTokens ? cacheReadInputTokens : undefined,
      };
    },
  },
};

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Runs one CLI to completion (or timeout), never rejecting — errors surface via exitCode/stderr. */
function runAgentProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ stdout: '', stderr: String(err), exitCode: null, timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), exitCode: null, timedOut });
    });
  });
}

/**
 * buildTaskMessage() prefixes a `--- WORKSTREAM ---` header for Artificer's
 * own communicator/task-intent parser (repoUrl/baseCommit/title fields an
 * external agent has no use for — it's already placed in the checked-out
 * repo). Strip it: besides being noise, a prompt starting with `--` gets
 * misread as an unknown flag by every one of these CLIs' own arg parsers.
 */
function stripWorkstreamHeader(message: string): string {
  return message.replace(/^-{3} WORKSTREAM -{3}\n[\s\S]*?\n-{3}\n\n/, '');
}

function emptyPrediction(instance: BenchInstance, modelName: string): Prediction {
  return { instance_id: instance.instance_id, model_name_or_path: modelName, model_patch: '' };
}

function runStep(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: path.join(BENCH_DIR, '..'), env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

/** Grades and reports right after the driver loop — only greenfield is Docker-free/fast enough to always run. */
async function gradeAndReport(resultsDir: string, kind: string): Promise<void> {
  if (kind !== 'greenfield') {
    // eslint-disable-next-line no-console
    console.log(
      `\n[external-agent] suite kind "${kind}" needs its own grader (Docker) — ` +
        `run it manually with BENCH_RESULTS_DIR=${resultsDir} set.`,
    );
    return;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, BENCH_RESULTS_DIR: resultsDir };
  // eslint-disable-next-line no-console
  console.log('\n[external-agent] grading with the greenfield evaluator...');
  await runStep('bash', [path.join(BENCH_DIR, 'eval', 'run-greenfield-eval.sh')], env);
  // eslint-disable-next-line no-console
  console.log('\n[external-agent] writing report...');
  await runStep('pnpm', ['exec', 'tsx', path.join(BENCH_DIR, 'src', 'report.ts')], env);
}

async function runOneInstance(
  agentId: string,
  spec: AgentSpec,
  instance: BenchInstance,
  model: string | undefined,
  timeoutMs: number,
): Promise<{ attempt: AttemptRecord; prediction: Prediction }> {
  const startedAt = Date.now();
  const modelName = `${agentId}${model ? `/${model}` : ''}`;
  const safeLabel = instance.instance_id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `artificer-bench-ext-${agentId}-${safeLabel}-`),
  );
  const repoDir = path.join(workspaceDir, 'repo');
  const repoUrl = instance.repository_url ?? `https://github.com/${instance.repo}.git`;

  try {
    await execFileAsync('git', ['clone', repoUrl, repoDir]);
    try {
      await execFileAsync('git', ['cat-file', '-e', `${instance.base_commit}^{commit}`], {
        cwd: repoDir,
      });
    } catch {
      await execFileAsync('git', ['fetch', '--depth', '1', 'origin', instance.base_commit], {
        cwd: repoDir,
      });
    }
    await execFileAsync('git', ['checkout', instance.base_commit], { cwd: repoDir });
  } catch (err) {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    return {
      attempt: {
        instanceId: instance.instance_id,
        repo: instance.repo,
        baseCommit: instance.base_commit,
        outcome: 'error',
        durationMs: Date.now() - startedAt,
        patchBytes: 0,
        error: `clone/checkout failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      prediction: emptyPrediction(instance, modelName),
    };
  }

  const prompt = stripWorkstreamHeader(buildTaskMessage(instance, { preflight: true }));
  const env = await sandboxGithubEnv(process.env, workspaceDir);
  const args = spec.buildArgs(prompt, model, repoDir);
  const result = await runAgentProcess(spec.command, args, repoDir, env, timeoutMs);

  const { patch, warning } = await extractPatch(workspaceDir, instance.base_commit);
  const usage = spec.parseUsage(result.stdout);
  const durationMs = Date.now() - startedAt;

  await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});

  const outcome: AttemptOutcome = result.timedOut
    ? 'timeout'
    : patch.trim()
      ? 'submitted'
      : 'empty_patch';

  const errorParts = [
    warning,
    result.exitCode !== 0 && result.exitCode !== null
      ? `${spec.command} exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`
      : undefined,
  ].filter(Boolean);

  const attempt: AttemptRecord = {
    instanceId: instance.instance_id,
    repo: instance.repo,
    baseCommit: instance.base_commit,
    outcome,
    durationMs,
    patchBytes: Buffer.byteLength(patch, 'utf8'),
    error: errorParts.length > 0 ? errorParts.join('; ') : undefined,
    usage:
      usage.costUsd !== undefined || usage.inputTokens !== undefined
        ? {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
            cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
            requests: 1,
            runs: 1,
            costUsd: usage.costUsd ?? 0,
          }
        : undefined,
  };

  return {
    attempt,
    prediction: { instance_id: instance.instance_id, model_name_or_path: modelName, model_patch: patch },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const agentId = flag(argv, 'agent');
  if (!agentId || !(agentId in AGENTS)) {
    // eslint-disable-next-line no-console
    console.error(
      `[external-agent] --agent is required, one of: ${Object.keys(AGENTS).join(', ')}`,
    );
    process.exit(1);
  }
  const spec = AGENTS[agentId];

  const suitePath = resolveSuitePath(flag(argv, 'suite') ?? 'tasks/greenfield-mini.json');
  const suite = await readSuite(suitePath);
  const suiteBase = path.basename(suitePath, '.json');

  const idsArg = flag(argv, 'instance-ids');
  const ids = idsArg ? idsArg.split(',').map((s) => s.trim()).filter(Boolean) : suite.instanceIds;
  const instances = await loadSuiteInstances(suite, ids);
  if (instances.length === 0) {
    // eslint-disable-next-line no-console
    console.error('[external-agent] no instances to run (check the suite / instance ids)');
    process.exit(1);
  }

  const model = flag(argv, 'model');
  const timeoutMs = Number(flag(argv, 'timeout-ms') ?? 900_000);
  const resultsDir =
    flag(argv, 'results-dir') ?? path.join(RESULTS_DIR, 'external', agentId, suiteBase);
  await fs.mkdir(resultsDir, { recursive: true });

  // eslint-disable-next-line no-console
  console.log(
    `[external-agent] suite=${suiteName(suite, suitePath)} · agent=${agentId}` +
      `${model ? `/${model}` : ''} · ${instances.length} instance(s)`,
  );

  const attempts: AttemptRecord[] = [];
  const predictions: Prediction[] = [];

  let i = 0;
  for (const instance of instances) {
    i += 1;
    // eslint-disable-next-line no-console
    console.log(`\n[external-agent] (${i}/${instances.length}) ${instance.instance_id}`);
    const { attempt, prediction } = await runOneInstance(agentId, spec, instance, model, timeoutMs);
    attempts.push(attempt);
    predictions.push(prediction);
    // eslint-disable-next-line no-console
    console.log(
      `[external-agent]   -> ${attempt.outcome} | ${(attempt.durationMs / 1000).toFixed(0)}s | ` +
        `patch ${attempt.patchBytes}B` +
        (attempt.usage ? ` | $${attempt.usage.costUsd.toFixed(4)}` : '') +
        (attempt.error ? ` | ${attempt.error}` : ''),
    );

    await fs.writeFile(
      path.join(resultsDir, 'predictions.jsonl'),
      `${predictions.map((p) => JSON.stringify(p)).join('\n')}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(resultsDir, 'attempts.json'),
      JSON.stringify(attempts, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(resultsDir, 'instances.json'),
      JSON.stringify(instances, null, 2),
      'utf8',
    );
  }

  // eslint-disable-next-line no-console
  console.log(`\n[external-agent] wrote results to ${resultsDir}`);
  await gradeAndReport(resultsDir, suiteKind(suite));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[external-agent] fatal:', err);
  process.exit(1);
});
