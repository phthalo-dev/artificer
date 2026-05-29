import type Anthropic from '@anthropic-ai/sdk';
import type { RuntimeConfig } from '../config.js';
import type { EngineApi, ToolContext } from '../context.js';
import { runToolLoop } from '../llm/anthropic.js';
import type { Store } from '../storage/store.js';
import type { RunRecord } from '../storage/types.js';
import { toolsForRole } from '../tools/registry.js';
import { getRole } from './roles.js';

export interface ExecuteCallDeps {
  client: Anthropic;
  config: RuntimeConfig;
  store: Store;
  engine: EngineApi;
}

/** Compose the context a call sees: its task plus a summary of its workstream. */
async function buildContext(store: Store, run: RunRecord): Promise<string> {
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
          ws.summary ? `Summary:\n${ws.summary}` : 'Summary: (none yet)',
        ]
          .filter(Boolean)
          .join('\n'),
      );
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
 * Executes a single role call: builds context, runs the tool-use loop with the
 * tools that role is allowed to use, and persists the run record throughout.
 */
export async function executeCall(
  run: RunRecord,
  deps: ExecuteCallDeps,
): Promise<RunRecord> {
  const { client, config, store, engine } = deps;

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
    const userMessage = await buildContext(store, run);

    const result = await runToolLoop({
      client,
      model: run.model ?? config.model,
      system: role.system(config.agentName),
      userMessage,
      tools,
      maxIterations: config.maxIterationsPerCall,
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
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date().toISOString();
    await store.saveRun(run);
    engine.emit({ kind: 'run', at: run.finishedAt, data: { ...run } });
    return run;
  }
}
