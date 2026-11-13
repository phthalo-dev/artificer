import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LanguageModel } from 'ai';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, ToolContext } from '../context.js';
import { buildPriorRunsDigest, clipDiff } from './context-compact.js';
import { compactionProfileForModel } from './compaction-thresholds.js';
import {
  formatSectionsFooter,
  renderSections,
  type ContextSectionId,
} from './context-sections.js';
import { FileCache } from './file-cache.js';
import { ingestPublishedArtifacts } from './artifact-ingest.js';
import { executorStateDir } from './executor-files.js';
import { formatCallError } from '../llm/errors.js';
import { runToolLoop } from '../llm/loop.js';
import type { Store } from '../storage/store.js';
import type { IdentityStore } from '../storage/identity-store.js';
import type { RunRecord, ToolInvocation } from '../storage/types.js';
import { emptyUsage } from '../storage/types.js';
import { createToolPlan } from '../tools/tool-plan.js';
import { loadEffectivePolicy } from '../tools/tool-policy.js';
import { findGitRepo } from './git-repo.js';
import type { ExecutorResult, WorkerExecutor } from './executor.js';
import { RoleRegistry } from './role-registry.js';
import type { ToolRegistry } from '../api/tool-registry.js';

const execAsync = promisify(exec);

// Status/review reporting instruction appended to executor context.
// MCP tools (report_status, submit_review) are preferred; text fallback
// catches cases where MCP is unavailable.
const EXECUTOR_STATUS_INSTRUCTION = `

---
When you finish:
- Workers: call the report_status MCP tool with status and summary.
- Reviewers: call the submit_review MCP tool with target, notes, approved, stage ("work"), and severity.

If MCP tools are unavailable, output one of the following on its own line at the very end:
- DONE — task is complete and verified
- DONE_WITH_CONCERNS — task is done but has known issues or caveats
- BLOCKED — you are genuinely stuck and cannot proceed`;

/** Roles that implement against the repo and benefit from working-set context. */
const WORK_ROLES = new Set<RunRecord['role']>([
  'planner',
  'worker',
  'reviewer',
]);

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated)`;
}

/** Best-effort summary of uncommitted changes so a fresh call sees prior work. */
async function changedFilesSummary(
  workspaceDir: string,
  includeDiff: boolean,
): Promise<string | null> {
  const repo = await findGitRepo(workspaceDir);
  if (!repo) return null;
  try {
    const { stdout } = await execAsync('git status --short', {
      cwd: repo,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const text = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .join('\n');
    if (!text) return null;
    const rel = path.relative(workspaceDir, repo) || '.';
    const sections = [
      `Files changed so far (git status --short, in ${rel}):\n${clip(text, 1_500)}`,
    ];
    if (includeDiff) {
      const diff = await uncommittedDiff(repo);
      if (diff)
        sections.push(`Current diff (git diff HEAD):\n${clipDiff(diff)}`);
    }
    return sections.join('\n\n');
  } catch {
    return null;
  }
}

/** Best-effort `git diff HEAD` of uncommitted changes, or null if unavailable. */
async function uncommittedDiff(repo: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git diff HEAD', {
      cwd: repo,
      timeout: 15_000,
      maxBuffer: 1024 * 1024 * 10,
    });
    const diff = stdout.trim();
    return diff || null;
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
  const done = tasks
    .filter((t) => t.status === 'done' && t.result)
    .sort(
      (a, b) =>
        a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id),
    )
    .slice(-5);
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
  executor?: WorkerExecutor;
  registry: RoleRegistry;
  customRegistry?: ToolRegistry;
  route?: import('./quota-types.js').DispatchRoute;
}

async function appendStatusAndSignpost(
  sections: string[],
  store: Store,
  identity?: IdentityStore,
): Promise<void> {
  const signpost = identity
    ? await identity.memorySignpost()
    : await store.memorySignpost();
  sections.push(
    [
      'You can use get_status to query more detail.',
      signpost ??
        'You have no memories saved yet; use add_memory to remember durable facts.',
    ].join(' '),
  );
}

function appendRenderedSection(
  sections: string[],
  updatedIds: ContextSectionId[],
  result: { id: ContextSectionId; body: string; updated: boolean },
  prefix?: string,
): void {
  if (result.updated && result.body) updatedIds.push(result.id);
  const text = prefix ? `${prefix} ${result.body}` : result.body;
  if (text) sections.push(text);
}

/** Compose the context a call sees: its task plus a summary of its workstream. */
export async function buildContext(
  store: Store,
  run: RunRecord,
  workspaceDir: string,
  config: RuntimeConfig,
  effectiveBaseRole: string,
  identity?: IdentityStore,
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
    // fresh investigation every time. Replay byte-identical section bodies
    // when hashes match so prompt caches can hit across consecutive calls.
    if (WORK_ROLES.has(effectiveBaseRole)) {
      const filePath = store.layout.contextSectionsFile(run.workstreamId);
      const updatedIds: ContextSectionId[] = [];
      const workstreamId = run.workstreamId;
      const includeDiff = effectiveBaseRole === 'reviewer';
      const gitSectionId: ContextSectionId = includeDiff
        ? 'git_status_diff'
        : 'git_status';

      const rendered = await renderSections({
        filePath,
        items: [
          {
            id: 'findings',
            compute: async () =>
              (await findingsBlock(store, workstreamId)) ?? '',
          },
          {
            id: 'recent_tasks',
            compute: async () =>
              (await recentWorkSummary(store, workstreamId)) ?? '',
          },
          {
            id: gitSectionId,
            compute: async () =>
              (await changedFilesSummary(workspaceDir, includeDiff)) ?? '',
          },
          {
            id: 'prior_runs',
            compute: async () => {
              const digestProfile = compactionProfileForModel(
                run.model ?? config.model,
                config.contextBorrowing.compactionProfile,
              );
              return (
                (await buildPriorRunsDigest(
                  store,
                  workstreamId,
                  run.id,
                  digestProfile.priorRunsToInclude,
                  config.contextBorrowing.microcompactEnabled,
                )) ?? ''
              );
            },
          },
          {
            id: 'file_cache',
            compute: async () => {
              const fileCache = await FileCache.load(
                store.layout,
                workstreamId,
                config.contextBorrowing.fileCacheMaxEntries,
              );
              return fileCache.formatHintBlock() ?? '';
            },
          },
          {
            id: 'memory_signpost',
            compute: async () => {
              const signpost = identity
                ? await identity.memorySignpost()
                : await store.memorySignpost();
              return (
                signpost ??
                'You have no memories saved yet; use add_memory to remember durable facts.'
              );
            },
          },
        ],
      });

      for (const result of rendered) {
        appendRenderedSection(
          sections,
          updatedIds,
          result,
          result.id === 'memory_signpost'
            ? 'You can use get_status to query more detail.'
            : undefined,
        );
      }
      sections.push(formatSectionsFooter(updatedIds));
    } else {
      await appendStatusAndSignpost(sections, store, identity);
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
    await appendStatusAndSignpost(sections, store, identity);
  }

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
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
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

  const onToolCall = (invocation: ToolInvocation) => {
    run.toolCalls.push(invocation);
    engine.emit({
      kind: 'tool',
      at: invocation.at,
      data: { ...invocation, runId: run.id },
    });
    if (run.workstreamId) {
      // Intentionally not awaited: tool callbacks must stay fast, and
      // withTraceChain still serializes events for this trace id.
      void engine.recordTraceEvent({
        workstreamId: run.workstreamId,
        kind: 'tool',
        sourceId: `${run.id}:tool:${run.toolCalls.length}`,
        runId: run.id,
        parentRunId: run.parentRunId,
        taskId: run.taskId,
        actor: { kind: 'role', role: run.role },
        data: {
          name: invocation.name,
          at: invocation.at,
          failed: Boolean(invocation.error),
          error: invocation.error,
          output: invocation.output,
        },
      });
    }
    void store.saveRun(run);
  };

  const ctx: ToolContext = { engine, run, workspaceDir, onToolCall };
  const roleDef = deps.registry.getRole(run.role);
  if (!roleDef) throw new Error(`Unknown role: '${run.role}'`);
  const effectiveBaseRole = roleDef.baseRole ?? run.role;
  const plan = createToolPlan({
    role: effectiveBaseRole,
    ctx,
    customRegistry: deps.customRegistry,
  });
  ctx.toolPlan = plan;
  const tools = [...plan.alwaysOn];

  run.status = 'running';
  run.startedAt = new Date().toISOString();
  await store.saveRun(run);
  engine.emit({ kind: 'run', at: run.startedAt, data: { ...run } });
  if (run.workstreamId) {
    await engine.recordTraceEvent({
      workstreamId: run.workstreamId,
      kind: 'run',
      sourceId: run.id,
      runId: run.id,
      parentRunId: run.parentRunId,
      taskId: run.taskId,
      actor: { kind: 'role', role: run.role },
      data: {
        event: 'started',
        role: run.role,
        task: run.task,
        model: run.model,
        startedAt: run.startedAt,
      },
    });
  }

  try {
    const userMessage = await buildContext(
      store,
      run,
      workspaceDir,
      config,
      effectiveBaseRole,
      engine.identity,
    );

    let resultText: string;
    let resultUsage: RunRecord['usage'];

    if (deps.executor && WORK_ROLES.has(effectiveBaseRole)) {
      const execContext = userMessage + EXECUTOR_STATUS_INSTRUCTION;
      let execResult: ExecutorResult;
      try {
        execResult = await deps.executor.execute({
          context: execContext,
          workspaceDir,
          run,
          role: effectiveBaseRole,
          policy: loadEffectivePolicy({
            execPath: store.layout.toolPolicyFile(),
            identityPath: engine.identity?.layout.agentToolPolicyFile(),
          }),
          onToolCall,
          emit: (event) => engine.emit(event),
        });
      } finally {
        if (run.workstreamId) {
          try {
            await ingestPublishedArtifacts(
              executorStateDir(workspaceDir),
              (input) =>
                engine.artifacts.publish(run.workstreamId!, {
                  ...input,
                  createdByRunId: run.id,
                }),
            );
          } catch (error) {
            console.error(
              `[run:${run.id}] failed to ingest published artifacts:`,
              error,
            );
          }
        }
      }
      resultText = execResult.text;
      resultUsage = {
        ...emptyUsage(),
        ...(execResult.usage ?? {}),
      };
      run.executor = deps.executor.name;

      // Synthesize a report_status tool call so workerRunDone / lastWorkerReport
      // work unchanged.
      if (execResult.workerStatus) {
        run.toolCalls.push({
          name: 'report_status',
          input: {
            status: execResult.workerStatus,
            summary: execResult.workerSummary ?? '',
            ...(execResult.workerFollowUps
              ? { followUps: execResult.workerFollowUps }
              : {}),
          },
          output: 'Status recorded via MCP.',
          at: new Date().toISOString(),
        });
      }

      // Synthesize a submit_review tool call and write the review record so the
      // workstream machine sees lastReviewApproved correctly.
      if (execResult.review && run.workstreamId) {
        const rev = execResult.review;
        await store.createReview({
          workstreamId: run.workstreamId,
          target: rev.target,
          notes: rev.notes,
          approved: rev.approved,
          stage: rev.stage,
          severity: rev.severity,
        });
        run.toolCalls.push({
          name: 'submit_review',
          input: rev,
          output: 'Review recorded via MCP.',
          at: new Date().toISOString(),
        });
      }
    } else {
      let runCharTotal = 0;

      // The planner gets a tighter iteration cap so it commits to write_plan
      // instead of investigating until the wall-clock/instance timeout.
      const maxIterations =
        effectiveBaseRole === 'planner'
          ? Math.min(config.maxPlannerIterations, config.maxIterationsPerCall)
          : config.maxIterationsPerCall;

      const system = config.globalInstructions
        ? `${roleDef.system(config.agentName)}\n\n${config.globalInstructions}`
        : roleDef.system(config.agentName);

      const modelId = run.model ?? config.model;
      const result = await runToolLoop({
        model: resolveModel(modelId),
        modelId,
        system,
        userMessage,
        tools,
        maxIterations,
        maxRunMs: config.maxRunMs,
        // The planner may emit a long plan in one response; give it room so the
        // plan isn't truncated mid-write.
        maxTokens: effectiveBaseRole === 'planner' ? 8192 : 4096,
        policy: loadEffectivePolicy({
          execPath: store.layout.toolPolicyFile(),
          identityPath: engine.identity?.layout.agentToolPolicyFile(),
        }),
        emit: (event) => engine.emit(event),
        runId: run.id,
        workstreamId: run.workstreamId,
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
        onToolCall,
      });
      resultText = result.text;
      resultUsage = result.usage;
    }

    run.output = resultText;
    run.usage = resultUsage;
    run.status = 'done';
    run.finishedAt = new Date().toISOString();
    await store.saveRun(run);
    engine.emit({ kind: 'run', at: run.finishedAt, data: { ...run } });
    if (run.workstreamId) {
      await engine.recordTraceEvent({
        workstreamId: run.workstreamId,
        kind: 'run',
        sourceId: `${run.id}:finished`,
        runId: run.id,
        parentRunId: run.parentRunId,
        taskId: run.taskId,
        actor: { kind: 'role', role: run.role },
        data: {
          event: 'finished',
          role: run.role,
          status: run.status,
          output: run.output,
          usage: run.usage,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
      });
    }
    return run;
  } catch (err) {
    run.status = 'failed';
    run.error = formatCallError(err);
    run.finishedAt = new Date().toISOString();
    console.error(`[run:${run.id}] ${run.role} failed:`, run.error);
    await store.saveRun(run);
    engine.emit({ kind: 'run', at: run.finishedAt, data: { ...run } });
    if (run.workstreamId) {
      await engine.recordTraceEvent({
        workstreamId: run.workstreamId,
        kind: 'run',
        sourceId: `${run.id}:finished`,
        runId: run.id,
        parentRunId: run.parentRunId,
        taskId: run.taskId,
        actor: { kind: 'role', role: run.role },
        data: {
          event: 'finished',
          role: run.role,
          status: run.status,
          error: run.error,
          usage: run.usage,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
      });
    }
    return run;
  }
}
