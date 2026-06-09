import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LanguageModel } from 'ai';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, ToolContext } from '../context.js';
import { buildPriorRunsDigest } from './context-compact.js';
import { FileCache } from './file-cache.js';
import { formatCallError } from '../llm/errors.js';
import { runToolLoop } from '../llm/loop.js';
import type { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { toolsForRole } from '../tools/registry.js';
import { findGitRepo } from './git-repo.js';
import { getRole } from './roles.js';

const execAsync = promisify(exec);

/** Roles that implement against the repo and benefit from working-set context. */
const WORK_ROLES = new Set<RunRecord['role']>(['planner', 'worker', 'reviewer']);

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated)`;
}

/** Best-effort summary of uncommitted changes so a fresh call sees prior work. */
async function changedFilesSummary(
  workspaceDir: string,
): Promise<string | null> {
  const repo = await findGitRepo(workspaceDir);
  if (!repo) return null;
  try {
    const { stdout } = await execAsync('git status --short', {
      cwd: repo,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const text = stdout.trim();
    if (!text) return null;
    const rel = path.relative(workspaceDir, repo) || '.';
    return `Files changed so far (git status --short, in ${rel}):\n${clip(text, 1_500)}`;
  } catch {
    return null;
  }
}

/** Recently completed work in this workstream, so calls don't re-discover it. */
async function recentWorkSummary(
  store: Store,
  workstreamId: string,
): Promise<string | null> {
  const tasks = await store.listTasks(workstreamId);
  const done = tasks.filter((t) => t.status === 'done' && t.result).slice(-5);
  if (done.length === 0) return null;
  const lines = done.map(
    (t) => `- [${t.role}] ${t.description}\n  ${clip(t.result ?? '', 400)}`,
  );
  return `Recent completed work in this workstream:\n${lines.join('\n')}`;
}

export interface ExecuteCallDeps {
  /** Resolves a model id to an AI SDK model bound to the configured gateway. */
  resolveModel: (modelId: string) => LanguageModel;
  config: RuntimeConfig;
  store: Store;
  engine: EngineApi;
}

/** Compose the context a call sees: its task plus a summary of its workstream. */
async function buildContext(
  store: Store,
  run: RunRecord,
  workspaceDir: string,
  config: RuntimeConfig,
): Promise<string> {
  const sections: string[] = [`Your task:\n${run.task}`];

  if (run.workstreamId) {
    const ws = await store.getWorkstream(run.workstreamId);
    if (ws) {
      sections.push(
        [
          `Workstream: ${ws.title} (${ws.id})`,
          `Goal: ${ws.goal}`,
          `Status: ${ws.status}`,
          ws.repoUrl ? `Repository: ${ws.repoUrl}` : null,
          ws.baseCommit
            ? `Base commit (checkout exactly): ${ws.baseCommit}`
            : null,
          ws.repoUrl
            ? 'Workspace: clone the repository into this directory (`.` or `repo/`), not /tmp or other paths outside the workspace.'
            : null,
          ws.summary ? `Summary:\n${ws.summary}` : 'Summary: (none yet)',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    // Give the roles that touch the repo continuity on what has already been
    // done, so they pick up where the last call left off instead of starting a
    // fresh investigation every time.
    if (WORK_ROLES.has(run.role)) {
      const findings = await findingsBlock(store, run.workstreamId);
      if (findings) sections.push(findings);

      const recent = await recentWorkSummary(store, run.workstreamId);
      if (recent) sections.push(recent);
      const changed = await changedFilesSummary(workspaceDir);
      if (changed) sections.push(changed);

      const digest = await buildPriorRunsDigest(
        store,
        run.workstreamId,
        run.id,
        8,
        config.contextBorrowing.microcompactEnabled,
      );
      if (digest) sections.push(digest);

      const fileCache = await FileCache.load(
        store.layout,
        run.workstreamId,
        config.contextBorrowing.fileCacheMaxEntries,
      );
      const fileHints = fileCache.formatHintBlock();
      if (fileHints) sections.push(fileHints);
    }
  } else {
    const all = await store.listWorkstreams();
    if (all.length > 0) {
      const overview = all
        .map((ws) => `- ${ws.title} (${ws.id}): ${ws.status}`)
        .join('\n');
      sections.push(`Current workstreams:\n${overview}`);
    } else {
      sections.push('Current workstreams: (none)');
    }
  }

  const signpost = await store.memorySignpost();
  sections.push(
    [
      'You can use get_status to query more detail.',
      signpost ??
        'You have no memories saved yet; use add_memory to remember durable facts.',
    ].join(' '),
  );

  return sections.join('\n\n');
}

/**
 * The workstream blackboard: durable findings each role recorded, so a role
 * reads what is already known instead of re-investigating. Oldest first.
 */
async function findingsBlock(
  store: Store,
  workstreamId: string,
): Promise<string | null> {
  const findings = await store.listFindings(workstreamId);
  if (findings.length === 0) return null;
  const lines = [...findings]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((f) => `- [${f.role}${f.file ? ` · ${f.file}` : ''}] ${f.note}`);
  return [
    'Findings already recorded on this workstream (the shared blackboard).',
    'Trust these and investigate only what they do not cover; add new ones with record_finding:',
    ...lines,
  ].join('\n');
}

/**
 * Executes a single role call: builds context, runs the tool-use loop with the
 * tools that role is allowed to use, and persists the run record throughout.
 */
export async function executeCall(
  run: RunRecord,
  deps: ExecuteCallDeps,
): Promise<RunRecord> {
  const { resolveModel, config, store, engine } = deps;

  const workspaceDir = run.workstreamId
    ? store.layout.workstreamWorkspace(run.workstreamId)
    : store.layout.workspaceDir;

  const ctx: ToolContext = { engine, run, workspaceDir };
  const tools = toolsForRole(run.role, ctx);
  const role = getRole(run.role);

  run.status = 'running';
  run.startedAt = new Date().toISOString();
  await store.saveRun(run);
  engine.emit({ kind: 'run', at: run.startedAt, data: { ...run } });

  try {
    const userMessage = await buildContext(store, run, workspaceDir, config);
    let runCharTotal = 0;

    // The planner gets a tighter iteration cap so it commits to write_plan
    // instead of investigating until the wall-clock/instance timeout.
    const maxIterations =
      run.role === 'planner'
        ? Math.min(config.maxPlannerIterations, config.maxIterationsPerCall)
        : config.maxIterationsPerCall;

    const result = await runToolLoop({
      model: resolveModel(run.model ?? config.model),
      system: role.system(config.agentName),
      userMessage,
      tools,
      maxIterations,
      maxRunMs: config.maxRunMs,
      // The planner may emit a long plan in one response; give it room so the
      // plan isn't truncated mid-write.
      maxTokens: run.role === 'planner' ? 8192 : 4096,
      toolResultSpill: {
        layout: store.layout,
        runId: run.id,
        config: config.contextBorrowing.toolResults,
        getRunCharTotal: () => runCharTotal,
        addRunChars: (n) => {
          runCharTotal += n;
        },
        onSpill: (info) => {
          engine.emit({
            kind: 'tool',
            at: new Date().toISOString(),
            data: {
              runId: run.id,
              name: info.tool,
              input: {},
              output: `[tool_result_spilled: ${info.path}]`,
              at: new Date().toISOString(),
              spillPath: info.path,
            },
          });
        },
      },
      onToolCall: (invocation) => {
        run.toolCalls.push(invocation);
        engine.emit({
          kind: 'tool',
          at: invocation.at,
          data: { ...invocation, runId: run.id },
        });
        void store.saveRun(run);
      },
    });

    run.output = result.text;
    run.usage = result.usage;
    run.status = 'done';
    run.finishedAt = new Date().toISOString();
    await store.saveRun(run);
    engine.emit({ kind: 'run', at: run.finishedAt, data: { ...run } });
    return run;
  } catch (err) {
    run.status = 'failed';
    run.error = formatCallError(err);
    run.finishedAt = new Date().toISOString();
    await store.saveRun(run);
    engine.emit({ kind: 'run', at: run.finishedAt, data: { ...run } });
    return run;
  }
}
