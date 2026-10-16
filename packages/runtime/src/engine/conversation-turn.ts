import {
  emptyUsage,
  type RunRecord,
  type Workstream,
} from '../storage/types.js';
import {
  conversationPreamble,
  conversationPrompt,
} from './conversation-prompt.js';
import type { WorkerExecutor } from './executor.js';

export interface RunConversationTurnInput {
  workstream: Pick<Workstream, 'id' | 'goal' | 'agentSessionId'>;
  repoPath: string;
  content: string;
  prior: Array<{ direction: 'inbound' | 'outbound'; content: string }>;
  executor?: WorkerExecutor;
  runBuiltin: (prompt: string, repoPath: string) => Promise<string>;
  signal?: AbortSignal;
  run?: RunRecord;
}

export async function runConversationTurn(
  input: RunConversationTurnInput,
): Promise<{ text: string; sessionId?: string }> {
  const preamble = conversationPreamble({
    workstreamId: input.workstream.id,
    goal: input.workstream.goal,
    repoPath: input.repoPath,
  });
  const resume = Boolean(
    input.executor?.resumesSession && input.workstream.agentSessionId,
  );
  const prompt = conversationPrompt({
    preamble,
    prior: input.prior,
    content: input.content,
    resume,
  });

  if (!input.executor) {
    const text = await input.runBuiltin(prompt, input.repoPath);
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
  const result = await input.executor.execute({
    context: prompt,
    workspaceDir: input.repoPath,
    run,
    sessionId: resume ? input.workstream.agentSessionId : undefined,
    signal: input.signal,
  });
  return {
    text: result.text.trim() ? result.text : '(no output)',
    sessionId: result.sessionId,
  };
}
