import type { CodemodeLimits } from '../config.js';
import type { ToolInvocation } from '../storage/types.js';

export type DiagnosticKind =
  | 'ParseError'
  | 'InvalidDataValue'
  | 'ToolCallLimitExceeded'
  | 'TimeoutExceeded'
  | 'ExecutionFailure';

export type CodemodeResult =
  | {
      ok: true;
      value: unknown;
      logs?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: false;
      error: { kind: DiagnosticKind; message: string };
      logs?: string[];
      truncated?: true;
      toolCalls: string[];
    };

export interface CodemodeTool {
  name: string;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export const CODEMODE_MAX_CONCURRENCY = 8;
export const CODEMODE_MEMORY_BYTES = 32 * 1024 * 1024;

export interface RunCodemodeOptions {
  code: string;
  tools: CodemodeTool[];
  limits: CodemodeLimits;
  onToolCall?: (invocation: ToolInvocation) => void;
}
