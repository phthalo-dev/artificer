import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { summarize } from './cost.js';
import { findGitRepo } from './git-repo.js';
import { workerRunSummary } from './worker-report.js';
import type { Store } from '../storage/store.js';
import { TraceRecorder } from '../storage/trace-recorder.js';
import type { SpawnCallInput } from '../context.js';
import type {
  Finding,
  Review,
  RunRecord,
  Task,
  Workstream,
  WorkstreamStatus,
} from '../storage/types.js';

const execFileAsync = promisify(execFile);
const receiptChains = new Map<string, Promise<void>>();
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_DETAIL_LENGTH = 1_000;
const MAX_FILES = 200;
const VALIDATION_COMMAND =
  /\b(?:test|tests|lint|type[- ]?check|build|check|verify|pytest|vitest|jest|mocha|cargo\s+test|go\s+test)\b/i;
const SHELL_FAILURE_RE = /^Command (failed|timed out)/;

export interface ReceiptStep {
  id: string;
  order: number;
  role: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  summary?: string;
  runIds: string[];
  taskIds: string[];
  startedAt?: string;
  finishedAt?: string;
}

export interface ReceiptChanges {
  repositoryUrl?: string;
  baseCommit?: string;
  headCommit?: string;
  branch?: string;
  files: string[];
  commits: string[];
  pullRequestUrl?: string;
}

export interface ReceiptValidation {
  label: string;
  command?: string;
  status: 'passed' | 'failed' | 'skipped' | 'unknown';
  summary?: string;
  runId?: string;
}

export interface ReceiptReview {
  id: string;
  stage?: 'plan' | 'work';
  target: string;
  approved: boolean;
  severity?: 'critical' | 'important' | 'minor' | 'none';
  summary: string;
  sourceReviewId: string;
}

export interface ReceiptFinding {
  id: string;
  role: string;
  file?: string;
  summary: string;
  sourceFindingId: string;
}

export interface ReceiptUsage {
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  modelRequests: number;
  estimatedCostDollars?: number;
  durationMs?: number;
}

export interface ReceiptLinks {
  localUrl: string;
  externalUrl?: string;
  artifactUrls?: string[];
}

export interface ReceiptProvenance {
  generatedFromTraceSequence?: number;
  generatedByRunId?: string;
  sourceUpdatedAt: string;
  redactionPolicyVersion: string;
}

export interface WorkstreamReceipt {
  schemaVersion: 1;
  id: string;
  workstreamId: string;
  traceId?: string;
  title: string;
  goal: string;
  status: WorkstreamStatus;
  summary: string;
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  steps: ReceiptStep[];
  changes: ReceiptChanges;
  validation: ReceiptValidation[];
  reviews: ReceiptReview[];
  findings: ReceiptFinding[];
  usage: ReceiptUsage;
  links: ReceiptLinks;
  provenance: ReceiptProvenance;
}

export interface WorkstreamReceiptResult {
  receipt: WorkstreamReceipt;
  markdown: string;
}

interface GitChanges {
  headCommit?: string;
  branch?: string;
  files: string[];
  commits: string[];
}

function clip(
  value: string | undefined,
  max = MAX_SUMMARY_LENGTH,
): string | undefined {
  if (!value) return undefined;
  const normalized = redact(value.trim());
  if (!normalized) return undefined;
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

function redact(value: string): string {
  return value
    .replace(
      /\b(?:sk|ghp|github_pat|xoxb|xoxp|trk)_[A-Za-z0-9_-]+\b/gi,
      '[REDACTED]',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
      (match) => `${match.slice(0, match.search(/[:=]/) + 1)}[REDACTED]`,
    );
}

function sortByCreated<T extends { createdAt: string; id: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function validTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function durationMs(
  runs: RunRecord[],
  workstream: Workstream,
): number | undefined {
  const starts = runs
    .map((run) => validTime(run.startedAt ?? run.createdAt))
    .filter((value): value is number => value !== undefined);
  const ends = runs
    .map((run) => validTime(run.finishedAt ?? run.createdAt))
    .filter((value): value is number => value !== undefined);
  if (starts.length === 0 || ends.length === 0) {
    const start = validTime(workstream.createdAt);
    const end = validTime(workstream.updatedAt);
    return start !== undefined && end !== undefined
      ? Math.max(0, end - start)
      : undefined;
  }
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

function runStatus(status: RunRecord['status']): ReceiptStep['status'] {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'pending';
}

function taskStatus(status: Task['status']): ReceiptStep['status'] {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'pending';
}

function runSummary(run: RunRecord | undefined): string | undefined {
  if (!run) return undefined;
  return clip(workerRunSummary(run) ?? run.output ?? run.error);
}

function buildSteps(tasks: Task[], runs: RunRecord[]): ReceiptStep[] {
  const orderedTasks = sortByCreated(tasks);
  if (orderedTasks.length > 0) {
    return orderedTasks.map((task, index) => {
      const taskRuns = sortByCreated(
        runs.filter((run) => run.taskId === task.id || run.id === task.runId),
      );
      const lastRun = taskRuns.at(-1);
      return {
        id: task.id,
        order: index + 1,
        role: task.role,
        label: clip(task.description, 240) ?? task.role,
        status: taskStatus(task.status),
        summary: clip(task.result) ?? runSummary(lastRun),
        runIds: taskRuns.map((run) => run.id),
        taskIds: [task.id],
        startedAt: taskRuns[0]?.startedAt ?? task.createdAt,
        finishedAt:
          taskRuns.at(-1)?.finishedAt ??
          (task.status === 'done' || task.status === 'failed'
            ? task.updatedAt
            : undefined),
      };
    });
  }

  return sortByCreated(runs).map((run, index) => ({
    id: run.id,
    order: index + 1,
    role: run.role,
    label: clip(run.task, 240) ?? run.role,
    status: runStatus(run.status),
    summary: runSummary(run),
    runIds: [run.id],
    taskIds: [],
    startedAt: run.startedAt ?? run.createdAt,
    finishedAt: run.finishedAt,
  }));
}

function validationStatus(
  invocation: RunRecord['toolCalls'][number],
): ReceiptValidation['status'] {
  if (invocation.error) return 'failed';
  if (SHELL_FAILURE_RE.test(invocation.output ?? '')) return 'failed';
  return 'passed';
}

function workstreamLocalUrl(workstreamId: string, publicUrl?: string): string {
  const path = `/workstreams/${encodeURIComponent(workstreamId)}`;
  if (!publicUrl) return path;
  return `${publicUrl.replace(/\/$/, '')}${path}`;
}

function buildValidation(runs: RunRecord[]): ReceiptValidation[] {
  const validation: ReceiptValidation[] = [];
  for (const run of sortByCreated(runs)) {
    for (const invocation of run.toolCalls) {
      if (invocation.name !== 'run_shell') continue;
      const input =
        typeof invocation.input === 'object' && invocation.input !== null
          ? (invocation.input as Record<string, unknown>)
          : {};
      const command =
        typeof input.command === 'string'
          ? input.command
          : typeof input.cmd === 'string'
            ? input.cmd
            : undefined;
      if (!command || !VALIDATION_COMMAND.test(command)) continue;
      validation.push({
        label: clip(command, 160) ?? 'validation command',
        command: clip(command, 500),
        status: validationStatus(invocation),
        summary: clip(invocation.error ?? invocation.output, MAX_DETAIL_LENGTH),
        runId: run.id,
      });
    }
  }
  return validation;
}

async function gitOutput(
  repo: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repo,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function parseGitFiles(output: string | undefined): string[] {
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        line
          .replace(/^[ MARCUD?!]{1,2}\s+/, '')
          .split(' -> ')
          .at(-1) ?? line,
    )
    .filter(Boolean);
}

async function inspectGit(
  store: Store,
  workstream: Workstream,
): Promise<GitChanges> {
  const empty: GitChanges = { files: [], commits: [] };
  const repo = await findGitRepo(
    store.layout.workstreamWorkspace(workstream.id),
  );
  if (!repo) return empty;

  const [headCommit, branch, status, diff] = await Promise.all([
    gitOutput(repo, ['rev-parse', 'HEAD']),
    gitOutput(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitOutput(repo, ['status', '--short']),
    gitOutput(repo, ['diff', '--name-only', 'HEAD']),
  ]);

  const files = new Set([...parseGitFiles(status), ...parseGitFiles(diff)]);
  const baseCommit = workstream.baseCommit;
  const validBase = baseCommit && /^[0-9a-f]{7,64}$/i.test(baseCommit);
  const [baseDiff, commits] = validBase
    ? await Promise.all([
        gitOutput(repo, ['diff', '--name-only', `${baseCommit}..HEAD`]),
        gitOutput(repo, ['log', '--format=%H', `${baseCommit}..HEAD`]),
      ])
    : [undefined, undefined];
  for (const file of parseGitFiles(baseDiff)) files.add(file);

  return {
    headCommit,
    branch: branch === 'HEAD' ? undefined : branch,
    files: [...files].sort().slice(0, MAX_FILES),
    commits: (commits?.split('\n').filter(Boolean) ?? []).slice(0, MAX_FILES),
  };
}

function buildSummary(
  workstream: Workstream,
  runs: RunRecord[],
): { summary: string; nextAction?: string } {
  const latest = sortByCreated(runs).at(-1);
  const summary =
    clip(workstream.summary) ??
    runSummary(latest) ??
    `Workstream is ${statusLabel(workstream.status)}.`;
  if (workstream.status === 'blocked' || workstream.status === 'failed') {
    return {
      summary,
      nextAction:
        clip(latest?.error) ??
        'Review the latest failed step and decide whether to retry or provide more context.',
    };
  }
  if (workstream.status !== 'done' && workstream.status !== 'cancelled') {
    return {
      summary,
      nextAction: 'Continue the next pending workstream step.',
    };
  }
  return { summary };
}

function renderMarkdown(receipt: WorkstreamReceipt): string {
  const lines = [
    `# ${receipt.title}`,
    '',
    `**Status:** ${statusLabel(receipt.status)}  `,
    `**Workstream:** \`${receipt.workstreamId}\`  `,
    `**Updated:** ${receipt.updatedAt}`,
    '',
    '## Goal',
    '',
    receipt.goal || 'No goal recorded.',
    '',
    '## Summary',
    '',
    receipt.summary || 'No summary available yet.',
    '',
    '## Steps',
    '',
  ];

  if (receipt.steps.length === 0) {
    lines.push('No steps recorded yet.', '');
  } else {
    for (const step of receipt.steps) {
      const checkbox = step.status === 'done' ? 'x' : ' ';
      const detail = step.summary ? ` — ${step.summary}` : '';
      lines.push(`- [${checkbox}] **${step.role}** — ${step.label}${detail}`);
    }
    lines.push('');
  }

  lines.push('## Changes', '');
  if (receipt.changes.repositoryUrl) {
    lines.push(`- Repository: \`${receipt.changes.repositoryUrl}\``);
  }
  if (receipt.changes.branch)
    lines.push(`- Branch: \`${receipt.changes.branch}\``);
  if (receipt.changes.baseCommit) {
    lines.push(`- Base commit: \`${receipt.changes.baseCommit}\``);
  }
  if (receipt.changes.headCommit) {
    lines.push(`- Head commit: \`${receipt.changes.headCommit}\``);
  }
  for (const file of receipt.changes.files) lines.push(`- \`${file}\``);
  if (receipt.changes.files.length === 0 && !receipt.changes.repositoryUrl) {
    lines.push('No repository changes recorded.');
  }
  lines.push('');

  lines.push('## Validation', '');
  if (receipt.validation.length === 0) {
    lines.push('No validation commands recorded.', '');
  } else {
    for (const check of receipt.validation) {
      const command = check.command ? ` \`${check.command}\`` : '';
      lines.push(
        `- **${check.status.toUpperCase()}**${command}${check.summary ? ` — ${check.summary}` : ''}`,
      );
    }
    lines.push('');
  }

  lines.push('## Review', '');
  if (receipt.reviews.length === 0) {
    lines.push('No reviews recorded.', '');
  } else {
    for (const review of receipt.reviews) {
      const status = review.approved ? 'approved' : 'changes requested';
      lines.push(`- **${status}** — ${review.target}: ${review.summary}`);
    }
    lines.push('');
  }

  lines.push('## Findings', '');
  if (receipt.findings.length === 0) {
    lines.push('No findings recorded.', '');
  } else {
    for (const finding of receipt.findings) {
      const file = finding.file ? ` (\`${finding.file}\`)` : '';
      lines.push(`- **${finding.role}**${file}: ${finding.summary}`);
    }
    lines.push('');
  }

  lines.push('## Usage', '');
  lines.push(`- Runs: ${receipt.usage.runCount}`);
  lines.push(
    `- Tokens: ${receipt.usage.inputTokens.toLocaleString()} in / ${receipt.usage.outputTokens.toLocaleString()} out`,
  );
  lines.push(`- Model requests: ${receipt.usage.modelRequests}`);
  if (receipt.usage.estimatedCostDollars !== undefined) {
    lines.push(
      `- Estimated cost: $${receipt.usage.estimatedCostDollars.toFixed(6)}`,
    );
  }
  if (receipt.usage.durationMs !== undefined) {
    lines.push(`- Duration: ${Math.round(receipt.usage.durationMs / 1000)}s`);
  }
  lines.push('');

  if (receipt.nextAction) {
    lines.push('## Next action', '', receipt.nextAction, '');
  }

  lines.push(
    '## Links',
    '',
    `- [Open in Artificer](${receipt.links.localUrl})`,
  );
  if (receipt.links.externalUrl) {
    lines.push(`- [Open trace](${receipt.links.externalUrl})`);
  }
  lines.push('');
  return lines.join('\n');
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporary, file);
}

async function writeTextAtomic(file: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, value, 'utf8');
  await fs.rename(temporary, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function withReceiptChain<T>(
  workstreamId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = receiptChains.get(workstreamId) ?? Promise.resolve();
  let result!: T;
  const next = previous
    .catch(() => {})
    .then(async () => {
      result = await fn();
    });
  receiptChains.set(workstreamId, next);
  await next;
  return result;
}

export class WorkstreamReceiptService {
  constructor(
    private readonly store: Store,
    private readonly traceRecorder: TraceRecorder,
    private readonly publicUrl?: string,
  ) {}

  async refresh(workstreamId: string): Promise<WorkstreamReceiptResult | null> {
    return withReceiptChain(workstreamId, async () => {
      const workstream = await this.store.getWorkstream(workstreamId);
      if (!workstream) return null;
      const [tasks, reviews, findings, runs, trace, changes] =
        await Promise.all([
          this.store.listTasks(workstreamId),
          this.store.listReviews(workstreamId),
          this.store.listFindings(workstreamId),
          this.store.listRunsForWorkstream(workstreamId),
          this.traceRecorder.get(workstream.traceId ?? `trace_${workstreamId}`),
          inspectGit(this.store, workstream),
        ]);
      const receipt = buildReceipt({
        workstream,
        tasks,
        reviews,
        findings,
        runs,
        traceSequence: trace?.lastSequence,
        changes,
        publicUrl: this.publicUrl,
      });
      const markdown = renderMarkdown(receipt);
      await writeJsonAtomic(
        this.store.layout.receiptFile(workstreamId),
        receipt,
      );
      await writeTextAtomic(
        this.store.layout.receiptMarkdownFile(workstreamId),
        markdown,
      );
      return { receipt, markdown };
    });
  }

  async ensureCurrent(
    workstreamId: string,
  ): Promise<WorkstreamReceiptResult | null> {
    const workstream = await this.store.getWorkstream(workstreamId);
    if (!workstream) return null;
    const receipt = await readJson<WorkstreamReceipt>(
      this.store.layout.receiptFile(workstreamId),
    );
    const markdown = await readText(
      this.store.layout.receiptMarkdownFile(workstreamId),
    );
    const trace = await this.traceRecorder.get(
      workstream.traceId ?? `trace_${workstreamId}`,
    );
    if (
      receipt &&
      markdown !== null &&
      receipt.provenance.sourceUpdatedAt === workstream.updatedAt &&
      receipt.provenance.generatedFromTraceSequence === trace?.lastSequence
    ) {
      return { receipt, markdown };
    }
    return this.refresh(workstreamId);
  }

  async get(workstreamId: string): Promise<WorkstreamReceipt | null> {
    return readJson<WorkstreamReceipt>(
      this.store.layout.receiptFile(workstreamId),
    );
  }

  async applyGeneratedSummary(
    workstreamId: string,
    summary: string,
    runId: string,
  ): Promise<WorkstreamReceiptResult | null> {
    return withReceiptChain(workstreamId, async () => {
      const receipt = await readJson<WorkstreamReceipt>(
        this.store.layout.receiptFile(workstreamId),
      );
      if (!receipt) return null;
      const nextSummary = clip(summary) ?? receipt.summary;
      const updated: WorkstreamReceipt = {
        ...receipt,
        summary: nextSummary,
        provenance: {
          ...receipt.provenance,
          generatedByRunId: runId,
        },
      };
      const markdown = renderMarkdown(updated);
      await writeJsonAtomic(
        this.store.layout.receiptFile(workstreamId),
        updated,
      );
      await writeTextAtomic(
        this.store.layout.receiptMarkdownFile(workstreamId),
        markdown,
      );
      return { receipt: updated, markdown };
    });
  }

  async requestSummary(
    ws: Workstream,
    spawn: (input: SpawnCallInput) => Promise<{ runId: string }>,
  ): Promise<{ runId: string } | null> {
    if (!['done', 'failed', 'blocked', 'cancelled'].includes(ws.status)) {
      return null;
    }
    const existing = await this.get(ws.id);
    if (existing?.provenance.generatedByRunId) return null;

    const current = await this.ensureCurrent(ws.id);
    if (!current) return null;

    const { runId } = await spawn({
      role: 'receipt',
      description: buildReceiptSummaryTask(current.receipt),
      workstreamId: ws.id,
    });
    return { runId };
  }
}

export function buildReceiptSummaryTask(receipt: WorkstreamReceipt): string {
  const facts = {
    title: receipt.title,
    goal: receipt.goal,
    status: receipt.status,
    steps: receipt.steps.map((step) => ({
      role: step.role,
      label: step.label,
      status: step.status,
      summary: step.summary,
    })),
    validation: receipt.validation.map((check) => ({
      label: check.label,
      status: check.status,
    })),
    reviews: receipt.reviews.map((review) => ({
      target: review.target,
      approved: review.approved,
      severity: review.severity,
    })),
    changes: {
      fileCount: receipt.changes.files.length,
      files: receipt.changes.files.slice(0, 20),
      commits: (receipt.changes.commits ?? []).slice(0, 10),
    },
    findings: receipt.findings.map((finding) => ({
      role: finding.role,
      summary: finding.summary,
    })),
    usage: receipt.usage,
    nextAction: receipt.nextAction,
  };

  return `Write a concise human-readable completion summary for this workstream delivery receipt.

Use ONLY the labeled facts below. Do not invent steps, files, or outcomes that are not present.
Do not include chain-of-thought, prompts, or raw tool output.
Keep the summary to 2-4 sentences focused on what was accomplished, what changed, and the outcome.
If the workstream failed or is blocked, state the reason and the next action clearly.

[Facts]
${JSON.stringify(facts, null, 2)}`;
}

function buildReceipt(input: {
  workstream: Workstream;
  tasks: Task[];
  reviews: Review[];
  findings: Finding[];
  runs: RunRecord[];
  traceSequence?: number;
  changes: GitChanges;
  publicUrl?: string;
}): WorkstreamReceipt {
  const { workstream, tasks, reviews, findings, runs, changes } = input;
  const orderedRuns = sortByCreated(runs);
  const usage = summarize(runs);
  const summary = buildSummary(workstream, orderedRuns);
  const starts = orderedRuns
    .map((run) => run.startedAt ?? run.createdAt)
    .sort();
  const finishes = orderedRuns
    .map((run) => run.finishedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const receiptId = `receipt_${workstream.id}`;

  return {
    schemaVersion: 1,
    id: receiptId,
    workstreamId: workstream.id,
    traceId: workstream.traceId ?? `trace_${workstream.id}`,
    title: redact(workstream.title),
    goal: redact(workstream.goal),
    status: workstream.status,
    summary: summary.summary,
    nextAction: summary.nextAction,
    createdAt: workstream.createdAt,
    updatedAt: workstream.updatedAt,
    startedAt: starts[0],
    finishedAt: finishes.at(-1),
    steps: buildSteps(tasks, orderedRuns),
    changes: {
      repositoryUrl: workstream.repoUrl,
      baseCommit: workstream.baseCommit,
      headCommit: changes.headCommit,
      branch: changes.branch,
      files: changes.files,
      commits: changes.commits,
    },
    validation: buildValidation(orderedRuns),
    reviews: sortByCreated(reviews).map((review) => ({
      id: review.id,
      stage: review.stage,
      target: redact(review.target),
      approved: review.approved,
      severity: review.severity,
      summary:
        clip(review.notes, MAX_DETAIL_LENGTH) ?? 'No review notes recorded.',
      sourceReviewId: review.id,
    })),
    findings: sortByCreated(findings).map((finding) => ({
      id: finding.id,
      role: finding.role,
      file: finding.file,
      summary:
        clip(finding.note, MAX_DETAIL_LENGTH) ?? 'No finding note recorded.',
      sourceFindingId: finding.id,
    })),
    usage: {
      runCount: usage.runs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      modelRequests: usage.requests,
      estimatedCostDollars: usage.costUsd,
      durationMs: durationMs(runs, workstream),
    },
    links: {
      localUrl: workstreamLocalUrl(workstream.id, input.publicUrl),
    },
    provenance: {
      generatedFromTraceSequence: input.traceSequence,
      sourceUpdatedAt: workstream.updatedAt,
      redactionPolicyVersion: 'v1',
    },
  };
}
