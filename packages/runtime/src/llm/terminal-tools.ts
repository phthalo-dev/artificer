/** Worker terminal tools that satisfy requireCompletionTool. */
export const WORKER_DONE_TOOL = 'declare_done';
export const WORKER_BLOCKED_TOOL = 'declare_blocked';

export const WORKER_TERMINAL_TOOLS = [WORKER_DONE_TOOL, WORKER_BLOCKED_TOOL] as const;

export type WorkerTerminalTool = (typeof WORKER_TERMINAL_TOOLS)[number];

export function isWorkerTerminalTool(name: string): name is WorkerTerminalTool {
  return (WORKER_TERMINAL_TOOLS as readonly string[]).includes(name);
}
