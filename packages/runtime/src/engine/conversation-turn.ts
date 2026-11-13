import type { RuntimeEvent } from '../context.js';
import {
  emptyUsage,
  type RunRecord,
  type ToolInvocation,
  type Workstream,
} from '../storage/types.js';
import type { ToolPolicyFile } from '../tools/tool-policy.js';
import {
  conversationPreamble,
  conversationPrompt,
} from './conversation-prompt.js';
import { ingestPublishedArtifacts } from './artifact-ingest.js';
import type { WorkerExecutor } from './executor.js';
import { executorStateDir } from './executor-files.js';
import type { PublishArtifactInput } from './workstream-artifacts.js';

export interface RunConversationTurnInput {
  workstream: Pick<Workstream, 'id' | 'goal' | 'agentSessionId'>;
  repoPath: string;
  content: string;
  prior: Array<{ direction: 'inbound' | 'outbound'; content: string }>;
  executor?: WorkerExecutor;
  publishArtifact?: (input: PublishArtifactInput) => Promise<unknown>;
  runBuiltin: (prompt: string, repoPath: string) => Promise<string>;
  signal?: AbortSignal;
  run?: RunRecord;
  policy?: ToolPolicyFile;
  onToolCall?: (invocation: ToolInvocation) => void;
  emit?: (event: RuntimeEvent) => void;
}

export function isStaleSessionError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes('no conversation found') ||
    message.includes('session not found') ||
    message.includes('no such session') ||
    message.includes('session does not exist')
  );
}

export async function runConversationTurn(
  input: RunConversationTurnInput,
): Promise<{ text: string; sessionId?: string; clearedSession?: boolean }> {
  const preamble = conversationPreamble({
    workstreamId: input.workstream.id,
    goal: input.workstream.goal,
    repoPath: input.repoPath,
  });
  const resume = Boolean(
    input.executor?.resumesSession && input.workstream.agentSessionId,
  );
  const transcriptPrompt = conversationPrompt({
    preamble,
    prior: input.prior,
    content: input.content,
    resume: false,
  });

  if (!input.executor) {
    const text = await input.runBuiltin(transcriptPrompt, input.repoPath);
    return { text: text.trim() ? text : '(no output)' };
  }

  const run =
    input.run ??
    ({
      id: 'conversation-turn',
      role: 'worker',
      task: input.content,
      workstreamId: input.workstream.id,
      status: 'running',
      toolCalls: [],
      usage: emptyUsage(),
      createdAt: new Date().toISOString(),
    } satisfies RunRecord);
  const execute = async (context: string, sessionId?: string) => {
    const options = {
      context,
      workspaceDir: input.repoPath,
      run,
      sessionId,
      signal: input.signal,
      policy: input.policy,
      onToolCall: input.onToolCall,
      emit: input.emit,
      ...(input.executor?.name === 'claude-code'
        ? { outputFormat: 'json' as const }
        : {}),
    };
    try {
      return await input.executor!.execute(options);
    } finally {
      if (input.publishArtifact) {
        try {
          await ingestPublishedArtifacts(
            executorStateDir(input.repoPath),
            input.publishArtifact,
          );
        } catch (error) {
          console.error('Failed to ingest published artifacts:', error);
        }
      }
    }
  };

  let result;
  let clearedSession = false;
  if (resume) {
    try {
      result = await execute(input.content, input.workstream.agentSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'cancelled' || !isStaleSessionError(error)) throw error;
      clearedSession = true;
      result = await execute(transcriptPrompt);
    }
  } else {
    result = await execute(transcriptPrompt);
  }
  return {
    text: result.text.trim() ? result.text : '(no output)',
    sessionId: result.sessionId,
    clearedSession: clearedSession || undefined,
  };
}
