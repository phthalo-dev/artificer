import type { CodemodeLimits } from '../config.js';
import type { ToolInvocation } from '../storage/types.js';

export type DiagnosticKind =
  | 'ParseError'
  | 'InvalidDataValue'
  | 'ToolCallLimitExceeded'
  | 'TimeoutExceeded'
  | 'ExecutionFailure'
  | 'CellNotFound'
  | 'CellLimitExceeded';

export type CodemodeResult =
  | {
      ok: true;
      value: unknown;
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: false;
      error: { kind: DiagnosticKind; message: string };
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    };

/**
 * One host segment of a cell: it either finished, gave control back with the
 * isolate still alive, or failed. `logs` / `notifications` / `toolCalls` are
 * cumulative for the cell, and the byte budget is applied per segment.
 */
export type CodemodeSegmentResult =
  | {
      ok: true;
      running: false;
      value: unknown;
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: true;
      running: true;
      cellId: string;
      value?: unknown;
      logs?: string[];
      notifications?: string[];
      truncated?: true;
      toolCalls: string[];
    }
  | {
      ok: false;
      error: { kind: DiagnosticKind; message: string };
      cellId?: string;
      logs?: string[];
      notifications?: string[];
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
