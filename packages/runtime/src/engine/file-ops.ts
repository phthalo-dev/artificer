import type { RunRecord } from '../storage/types.js';

function pathFromInput(input: unknown, keys: string[]): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.replace(/\\/g, '/');
    }
  }
  return undefined;
}

/** Collect file paths read or edited across runs (for compaction summaries). */
export function extractFileOps(runs: RunRecord[]): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const read = new Set<string>();
  const modified = new Set<string>();

  for (const run of runs) {
    for (const inv of run.toolCalls) {
      if (inv.error) continue;
      if (inv.name === 'read_file') {
        const p = pathFromInput(inv.input, ['path', 'file_path', 'filePath']);
        if (p) read.add(p);
      }
      if (inv.name === 'edit_file' || inv.name === 'write_file') {
        const p = pathFromInput(inv.input, ['path', 'file_path', 'filePath']);
        if (p) modified.add(p);
      }
    }
  }

  return {
    readFiles: [...read].sort(),
    modifiedFiles: [...modified].sort(),
  };
}

export function formatFileOpsLedger(ops: {
  readFiles: string[];
  modifiedFiles: string[];
}): string {
  const lines: string[] = [];
  if (ops.readFiles.length > 0) {
    lines.push(`<read-files>\n${ops.readFiles.join('\n')}\n</read-files>`);
  }
  if (ops.modifiedFiles.length > 0) {
    lines.push(`<modified-files>\n${ops.modifiedFiles.join('\n')}\n</modified-files>`);
  }
  return lines.join('\n\n');
}
