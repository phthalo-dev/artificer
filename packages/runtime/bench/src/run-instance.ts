import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { BenchConfig } from './config.js';
import { collectCost } from './cost.js';
import type { RunNode } from './client.js';
import { type RuntimeEvent, subscribeEvents } from './events.js';
import { extractPatch } from './extract-patch.js';
import { decidePoll } from './poll.js';
import type { RuntimeHandle } from './runtime-process.js';
import type {
  AttemptOutcome,
  AttemptRecord,
  BenchInstance,
  Prediction,
} from './types.js';

const execAsync = promisify(exec);

/**
 * Prints concise live progress lines from the runtime's event stream:
 * workstream status changes, role calls starting/finishing, and (optionally)
 * tool calls. Returns a stop() that detaches the listener.
 */
function startProgress(
  runtime: RuntimeHandle,
  config: BenchConfig,
  startedAt: number,
): () => void {
  const controller = new AbortController();
  const roleByRun = new Map<string, string>();

  const stamp = (): string => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `   [${mm}:${ss}]`;
  };

  const onEvent = (event: RuntimeEvent): void => {
    if (event.kind === 'workstream') {
      // eslint-disable-next-line no-console
      console.log(`${stamp()} workstream -> ${event.data?.status}`);
    } else if (event.kind === 'run') {
      const role = event.data?.role ?? 'call';
      const status = event.data?.status;
      if (event.data?.id) roleByRun.set(event.data.id, role);
      if (status === 'running') console.log(`${stamp()} \u25b6 ${role}`);
      else if (status === 'done') console.log(`${stamp()} \u2713 ${role}`);
      else if (status === 'failed')
        // eslint-disable-next-line no-console
        console.log(
          `${stamp()} \u2717 ${role}${event.data?.error ? `: ${truncate(event.data.error, 80)}` : ''}`,
        );
    } else if (event.kind === 'tool' && config.showTools) {
      const role = roleByRun.get(event.data?.runId) ?? '?';
      const hint = toolHint(event.data?.input);
      // eslint-disable-next-line no-console
      console.log(
        `${stamp()}     \u00b7 ${role}: ${event.data?.name}${hint ? ` ${hint}` : ''}`,
      );
    }
  };

  void subscribeEvents(runtime.client.baseUrl, onEvent, controller.signal);
  return () => controller.abort();
}

/** A short, single-line hint from a tool's input (command, path, etc.). */
function toolHint(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const key = ['command', 'path', 'query', 'workstreamId', 'status'].find(
    (k) => typeof obj[k] === 'string',
  );
  return key ? `(${truncate(String(obj[key]), 60)})` : '';
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}\u2026` : oneLine;
}

/** Machine-readable header the communicator can pass to start_workstream. */
export function buildWorkstreamHeader(instance: BenchInstance): string {
  const repoUrl =
    instance.repository_url ?? `https://github.com/${instance.repo}.git`;
  const title =
    instance.display_title ??
    `${instance.repo.split('/').pop() ?? instance.repo} task`;
  return [
    '--- WORKSTREAM ---',
    `repoUrl: ${repoUrl}`,
    `baseCommit: ${instance.base_commit}`,
    `title: ${title}`,
    '---',
  ].join('\n');
}

interface SetupTracker {
  learnCallCount: number;
  setupPhaseMs?: number;
  firstEditMs?: number;
  stop: () => void;
  notePreflightComplete: () => void;
}

/** Subscribe to runtime events and record setup-phase metrics. */
function startSetupTracker(
  runtime: RuntimeHandle,
  startedAt: number,
): SetupTracker {
  const controller = new AbortController();
  const roleByRun = new Map<string, string>();
  const state: SetupTracker = {
    learnCallCount: 0,
    stop: () => controller.abort(),
    notePreflightComplete: () => {
      state.setupPhaseMs ??= Date.now() - startedAt;
    },
  };

  const onEvent = (event: RuntimeEvent): void => {
    if (event.kind === 'run' && event.data?.id && event.data?.role) {
      roleByRun.set(event.data.id, event.data.role);
    }
    if (event.kind !== 'tool') return;

    const role = roleByRun.get(event.data?.runId ?? '') ?? '';
    const name = event.data?.name ?? '';
    const input = event.data?.input;

    if (role === 'communicator' && name === 'learn') {
      state.learnCallCount += 1;
    }

    if (
      state.setupPhaseMs === undefined &&
      name === 'run_shell' &&
      typeof (input as { command?: string })?.command === 'string' &&
      /\bgit\s+clone\b/i.test((input as { command: string }).command)
    ) {
      state.setupPhaseMs = Date.now() - startedAt;
    }

    if (
      state.firstEditMs === undefined &&
      (name === 'edit_file' || name === 'write_file')
    ) {
      state.firstEditMs = Date.now() - startedAt;
    }
  };

  void subscribeEvents(runtime.client.baseUrl, onEvent, controller.signal);
  return state;
}

async function findGitRepoInWorkspace(
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
    // missing workspace
  }
  return undefined;
}

/** Harbor-style preflight: clone + checkout before the agent investigates. */
async function preflightClone(
  workspaceDir: string,
  repoUrl: string,
  baseCommit: string,
): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true });
  await execAsync(`git clone --depth 1 ${shellQuote(repoUrl)} repo`, {
    cwd: workspaceDir,
    timeout: 120_000,
  });
  const repoDir = path.join(workspaceDir, 'repo');
  try {
    await execAsync(`git cat-file -e ${shellQuote(baseCommit)}^{commit}`, {
      cwd: repoDir,
      timeout: 30_000,
    });
  } catch {
    await execAsync(
      `git fetch --depth 1 origin ${shellQuote(baseCommit)}`,
      { cwd: repoDir, timeout: 120_000 },
    );
  }
  await execAsync(`git checkout ${shellQuote(baseCommit)}`, {
    cwd: repoDir,
    timeout: 30_000,
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Builds the task message handed to the agent for one benchmark instance. */
export function buildTaskMessage(
  instance: BenchInstance,
  options?: { preflight?: boolean },
): string {
  const repoUrl =
    instance.repository_url ?? `https://github.com/${instance.repo}.git`;
  const header = buildWorkstreamHeader(instance);

  if (instance.suite === 'deepswe') {
    if (options?.preflight) {
      return [
        header,
        '',
        `Complete the software engineering task below in ${instance.repo}.`,
        '',
        'The repository is already cloned at `repo/` and checked out at the base commit.',
        'Investigate with read_file, grep, and run_shell on the local tree.',
        'Implement the requested behavior by editing the repository source.',
        'The verifier tests observable behavior, not a specific implementation shape.',
        'Do not modify or add test files. Do not open a pull request; leave the',
        'change applied in the working tree.',
        '',
        instance.problem_statement,
      ].join('\n');
    }

    return [
      header,
      '',
      `Complete the software engineering task below in ${instance.repo}.`,
      '',
      'Setup (do this first, exactly):',
      `1. Clone ${repoUrl} into your workspace.`,
      `2. Check out the exact base commit ${instance.base_commit}.`,
      '',
      'Implement the requested behavior by editing the repository source.',
      'The verifier tests observable behavior, not a specific implementation shape.',
      'Do not modify or add test files. Do not open a pull request; leave the',
      'change applied in the working tree.',
      '',
      instance.problem_statement,
    ].join('\n');
  }

  if (options?.preflight) {
    return [
      header,
      '',
      `Fix a bug in the GitHub repository ${instance.repo}.`,
      '',
      'The repository is already cloned at `repo/` and checked out at the base commit.',
      'Investigate with read_file, grep, and run_shell on the local tree.',
      'Then resolve the issue described below by editing the repository source.',
      'Make the minimal code changes needed to fix the problem. Do NOT modify or',
      'add test files unless the issue is specifically about tests — the grading',
      'tests are supplied separately. Do not open a pull request; just leave the',
      'fix applied in the working tree.',
      '',
      '--- ISSUE ---',
      instance.problem_statement,
    ].join('\n');
  }

  return [
    header,
    '',
    `Fix a bug in the GitHub repository ${instance.repo}.`,
    '',
    'Setup (do this first, exactly):',
    `1. Clone ${repoUrl} into your workspace.`,
    `2. Check out the exact base commit ${instance.base_commit} (do not update to a newer commit).`,
    '',
    'Then resolve the issue described below by editing the repository source.',
    'Make the minimal code changes needed to fix the problem. Do NOT modify or',
    'add test files unless the issue is specifically about tests — the grading',
    'tests are supplied separately. Do not open a pull request; just leave the',
    'fix applied in the working tree. Success means the project\u2019s failing',
    'tests for this issue would pass after your change.',
    '',
    '--- ISSUE ---',
    instance.problem_statement,
  ].join('\n');
}

export interface InstanceResult {
  attempt: AttemptRecord;
  prediction: Prediction;
}

/**
 * Drives a single instance against an already-running, isolated runtime:
 * submit the task, poll to a terminal state (or timeout), extract the patch,
 * and collect cost. Always returns a prediction (possibly an empty patch) so
 * the evaluator can score every instance.
 */
export async function runInstance(
  runtime: RuntimeHandle,
  instance: BenchInstance,
  config: BenchConfig,
): Promise<InstanceResult> {
  const startedAt = Date.now();
  const { client } = runtime;

  const setupTracker = startSetupTracker(runtime, startedAt);

  const baseRecord = (): AttemptRecord => ({
    instanceId: instance.instance_id,
    repo: instance.repo,
    baseCommit: instance.base_commit,
    outcome: 'error',
    durationMs: Date.now() - startedAt,
    patchBytes: 0,
  });

  const stopProgress = config.liveProgress
    ? startProgress(runtime, config, startedAt)
    : () => {};

  const repoUrl =
    instance.repository_url ?? `https://github.com/${instance.repo}.git`;
  const title =
    instance.display_title ??
    `${instance.repo.split('/').pop() ?? instance.repo} task`;

  const failEarly = (err: unknown): InstanceResult => {
    setupTracker.stop();
    stopProgress();
    const rec = baseRecord();
    rec.error = err instanceof Error ? err.message : String(err);
    rec.learnCallCount = setupTracker.learnCallCount;
    return {
      attempt: rec,
      prediction: emptyPrediction(instance, config.modelName),
    };
  };

  // Structured intake: create the workstream directly (no communicator). When
  // preflighting, hold the orchestrator (autostart=false), clone into the
  // workspace, then release — so the repo is on disk before any agent runs.
  let messageId: string | undefined;
  let workstreamId: string | undefined;
  try {
    const created = await client.createWorkstream({
      title,
      goal: buildTaskMessage(instance, { preflight: config.preflightClone }),
      repoUrl,
      baseCommit: instance.base_commit,
      autostart: !config.preflightClone,
    });
    workstreamId = created.workstreamId;
    messageId = created.messageId;
  } catch (err) {
    return failEarly(err);
  }

  if (config.preflightClone && workstreamId && messageId) {
    const workspaceDir = path.join(runtime.dataDir, 'workspace', workstreamId);
    try {
      await preflightClone(workspaceDir, repoUrl, instance.base_commit);
      setupTracker.notePreflightComplete();
      await client.startWorkstreamWork(workstreamId, messageId);
    } catch (err) {
      return failEarly(err);
    }
  }

  const deadline = startedAt + config.instanceTimeoutMs;
  let workstreamStatus: AttemptRecord['workstreamStatus'];
  let outcome: AttemptOutcome = 'timeout';
  // Grace window: if the agent never starts a workstream and goes idle, stop.
  let idleSince: number | undefined;

  // Grace before declaring an idle queue dead — covers normal between-run gaps.
  const idleGraceMs = config.pollIntervalMs * 3;
  while (Date.now() < deadline) {
    await sleep(config.pollIntervalMs);
    let state;
    try {
      state = await client.getState();
    } catch {
      continue;
    }

    const ws = state.workstreams[0];
    if (ws) {
      workstreamId = ws.id;
      workstreamStatus = ws.status;
    }

    const decision = decidePoll(state, idleSince, Date.now(), idleGraceMs);
    if (decision.kind === 'terminal') {
      outcome = decision.outcome;
      workstreamStatus = decision.workstreamStatus ?? workstreamStatus;
      break;
    }
    if (decision.kind === 'stalled') {
      // Workstream exists but nothing is running/queued (e.g. orchestrator
      // stalled without dispatching), or no workstream ever started.
      outcome = 'failed';
      break;
    }
    idleSince = decision.idleSince;
  }

  stopProgress();
  setupTracker.stop();

  const rec = baseRecord();
  rec.messageId = messageId;
  rec.workstreamId = workstreamId;
  rec.workstreamStatus = workstreamStatus;
  rec.outcome = outcome;

  // Extract whatever patch exists, even on timeout/blocked, for partial credit.
  let patch = '';
  if (workstreamId) {
    const workspaceDir = path.join(runtime.dataDir, 'workspace', workstreamId);
    const clonePath = await findGitRepoInWorkspace(workspaceDir);
    rec.localRepoReady = clonePath !== undefined;
    if (clonePath) {
      rec.cloneLocation =
        path.relative(workspaceDir, clonePath) || '.';
    }

    const result = await extractPatch(workspaceDir, instance.base_commit).catch(
      (err) => ({ patch: '', warning: String(err) }),
    );
    patch = result.patch;
    if (result.warning && !rec.error) rec.error = result.warning;
  } else if (outcome === 'failed') {
    rec.error ??= 'agent did not start a workstream';
  }

  rec.patchBytes = Buffer.byteLength(patch, 'utf8');
  if (outcome === 'submitted' && rec.patchBytes === 0) {
    rec.outcome = 'empty_patch';
  }

  // Attach cost/usage for this message's whole call tree, and persist the tree
  // itself as a trajectory the UI can render on the benchmark run page.
  if (messageId) {
    const cost = await collectCost(client, messageId).catch(() => undefined);
    if (cost) {
      rec.usage = cost.total;
      rec.byRole = cost.byRole;
      await persistTrajectory(config, instance.instance_id, cost.tree).catch(
        () => {},
      );
    }
  }

  rec.durationMs = Date.now() - startedAt;
  rec.learnCallCount = setupTracker.learnCallCount;
  rec.setupPhaseMs = setupTracker.setupPhaseMs;
  rec.firstEditMs = setupTracker.firstEditMs;

  return {
    attempt: rec,
    prediction: {
      instance_id: instance.instance_id,
      model_name_or_path: config.modelName,
      model_patch: patch,
    },
  };
}

/**
 * Writes the call tree for one instance to results/runs/<id>.json. The runtime
 * server reads these files to render the benchmark run page's trajectory tab.
 */
async function persistTrajectory(
  config: BenchConfig,
  instanceId: string,
  tree: RunNode[],
): Promise<void> {
  if (tree.length === 0) return;
  const dir = path.join(config.resultsDir, 'runs');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${instanceId}.json`),
    JSON.stringify({ tree }, null, 2),
    'utf8',
  );
}

function emptyPrediction(
  instance: BenchInstance,
  modelName: string,
): Prediction {
  return {
    instance_id: instance.instance_id,
    model_name_or_path: modelName,
    model_patch: '',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
