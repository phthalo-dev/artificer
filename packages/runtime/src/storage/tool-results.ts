import fs from 'node:fs/promises';
import path from 'node:path';
import type { Layout } from './layout.js';

export interface SpillToolResultInput {
  layout: Layout;
  runId: string;
  index: number;
  toolName: string;
  body: string;
  maxChars: number;
}

export interface SpillToolResultOutput {
  output: string;
  spillPath: string;
  spillKey: string;
  previewChars: number;
}

function spillKeyFor(index: number, toolName: string): string {
  const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${index}-${safeName}.txt`;
}

function previewHint(spillKey: string, preview: string): string {
  return `[spilled ${preview.length} chars; full output saved. Use read_tool_result with spill_key="${spillKey}"]\n\n${preview}`;
}

export async function spillToolResult(
  input: SpillToolResultInput,
): Promise<SpillToolResultOutput> {
  const { layout, runId, index, toolName, body, maxChars } = input;
  const spillKey = spillKeyFor(index, toolName);
  const dir = layout.toolResultsDir(runId);
  const spillPath = path.join(dir, spillKey);

  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(spillPath, body, 'utf8');
  } catch {
    const truncated = body.slice(0, maxChars);
    return {
      output: `${truncated}\n(spill failed)`,
      spillPath,
      spillKey,
      previewChars: truncated.length,
    };
  }

  const preview = body.slice(0, maxChars);
  return {
    output: previewHint(spillKey, preview),
    spillPath,
    spillKey,
    previewChars: preview.length,
  };
}

export function resolveSpillPath(
  layout: Layout,
  runId: string,
  spillKey: string,
): string {
  const normalized = path.normalize(spillKey);
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`Spill key "${spillKey}" is not allowed.`);
  }
  const dir = path.resolve(layout.toolResultsDir(runId));
  const resolved = path.resolve(dir, normalized);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new Error(`Spill key "${spillKey}" is outside tool-results directory.`);
  }
  return resolved;
}

export async function readSpilledResult(
  layout: Layout,
  runId: string,
  spillKey: string,
  offset = 0,
  limit?: number,
): Promise<string> {
  const filePath = resolveSpillPath(layout, runId, spillKey);
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const start = Math.max(0, offset);
  const end = limit !== undefined ? start + limit : lines.length;
  const slice = lines.slice(start, end);
  return slice
    .map((line, i) => `${start + i + 1}|${line}`)
    .join('\n');
}

export interface ApplyResultBudgetInput {
  layout: Layout;
  runId: string;
  index: number;
  toolName: string;
  body: string;
  maxPerInvocation: number;
  maxPerRun: number;
  runTotalChars: number;
}

export interface ApplyResultBudgetOutput {
  output: string;
  runTotalChars: number;
  spillPath?: string;
  spillKey?: string;
}

export async function applyResultBudget(
  input: ApplyResultBudgetInput,
): Promise<ApplyResultBudgetOutput> {
  const {
    layout,
    runId,
    index,
    toolName,
    body,
    maxPerInvocation,
    maxPerRun,
    runTotalChars,
  } = input;

  const remainingRunBudget = maxPerRun - runTotalChars;
  if (remainingRunBudget <= 0) {
    return {
      output: '(tool output omitted: per-run character budget exhausted)',
      runTotalChars: runTotalChars,
    };
  }

  if (body.length <= maxPerInvocation && body.length <= remainingRunBudget) {
    return {
      output: body,
      runTotalChars: runTotalChars + body.length,
    };
  }

  if (body.length > maxPerInvocation) {
    const previewMax = Math.min(maxPerInvocation, remainingRunBudget);
    if (previewMax <= 0) {
      return {
        output: '(tool output omitted: per-run character budget exhausted)',
        runTotalChars: runTotalChars,
      };
    }
    const spilled = await spillToolResult({
      layout,
      runId,
      index,
      toolName,
      body,
      maxChars: previewMax,
    });
    return {
      output: spilled.output,
      runTotalChars: runTotalChars + spilled.previewChars,
      spillPath: spilled.spillPath,
      spillKey: spilled.spillKey,
    };
  }

  const truncated = body.slice(0, remainingRunBudget);
  return {
    output: `${truncated}\n... (output truncated: per-run budget)`,
    runTotalChars: runTotalChars + truncated.length,
  };
}
