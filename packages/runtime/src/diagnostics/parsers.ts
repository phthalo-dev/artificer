import type { Diagnostic, DiagnosticParser, ExecResult } from './types.js';

/**
 * Parse `tsc --noEmit --pretty false` output. Lines look like:
 *   src/foo.ts(12,5): error TS2322: Type 'string' is not assignable...
 */
export const tscParser: DiagnosticParser = (result) => {
  const diagnostics: Diagnostic[] = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;
  for (const line of result.stdout.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    diagnostics.push({
      file: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] === 'warning' ? 'warning' : 'error',
      message: `${m[5]}: ${m[6]}`,
      source: 'tsc',
    });
  }
  return diagnostics;
};

/**
 * Parse `ruff check --output-format json`. Output is a JSON array of objects:
 *   { filename, location: { row, column }, code, message }
 */
export const ruffJsonParser: DiagnosticParser = (result) => {
  const raw = result.stdout.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const diagnostics: Diagnostic[] = [];
  for (const item of parsed as Array<Record<string, unknown>>) {
    const location = (item.location ?? {}) as Record<string, unknown>;
    const code = item.code ? `${String(item.code)}: ` : '';
    diagnostics.push({
      file: String(item.filename ?? ''),
      line: location.row != null ? Number(location.row) : undefined,
      column: location.column != null ? Number(location.column) : undefined,
      severity: 'error',
      message: `${code}${String(item.message ?? '')}`,
      source: 'ruff',
    });
  }
  return diagnostics;
};

/**
 * Parse `eslint --format json`. Output is an array of file results, each with a
 * `messages` array ({ line, column, severity, message, ruleId }).
 */
export const eslintJsonParser: DiagnosticParser = (result) => {
  const raw = result.stdout.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const diagnostics: Diagnostic[] = [];
  for (const fileResult of parsed as Array<Record<string, unknown>>) {
    const filePath = String(fileResult.filePath ?? '');
    const messages = (fileResult.messages ?? []) as Array<
      Record<string, unknown>
    >;
    for (const msg of messages) {
      const rule = msg.ruleId ? `${String(msg.ruleId)}: ` : '';
      diagnostics.push({
        file: filePath,
        line: msg.line != null ? Number(msg.line) : undefined,
        column: msg.column != null ? Number(msg.column) : undefined,
        severity: Number(msg.severity) === 2 ? 'error' : 'warning',
        message: `${rule}${String(msg.message ?? '')}`,
        source: 'eslint',
      });
    }
  }
  return diagnostics;
};

/**
 * Build a parser from a regex with named capture groups. Recognized groups:
 * file, line, col, message. Applied to both stdout and stderr.
 */
export function makeRegexParser(pattern: string, source: string): DiagnosticParser {
  const re = new RegExp(pattern);
  return (result) => {
    const diagnostics: Diagnostic[] = [];
    const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
    for (const line of text.split('\n')) {
      const m = line.match(re);
      if (!m?.groups) continue;
      const g = m.groups;
      diagnostics.push({
        file: g.file ?? '',
        line: g.line ? Number(g.line) : undefined,
        column: g.col ? Number(g.col) : undefined,
        severity: 'error',
        message: g.message ?? line,
        source,
      });
    }
    return diagnostics;
  };
}

/**
 * Treat any non-zero exit as a single diagnostic carrying the command's stderr
 * (or stdout). The crudest fallback for checkers without structured output.
 */
export function makeExitCodeParser(source: string): DiagnosticParser {
  return (result) => {
    if (result.code === 0) return [];
    const message = (result.stderr || result.stdout || 'check failed').trim();
    return [{ file: '', severity: 'error', message, source }];
  };
}

export function parserFor(
  result: ExecResult,
  kind: string,
  opts: { pattern?: string; source: string },
): Diagnostic[] {
  switch (kind) {
    case 'tsc':
      return tscParser(result);
    case 'ruff-json':
      return ruffJsonParser(result);
    case 'eslint-json':
      return eslintJsonParser(result);
    case 'regex':
      if (!opts.pattern) return [];
      return makeRegexParser(opts.pattern, opts.source)(result);
    case 'exit-code':
      return makeExitCodeParser(opts.source)(result);
    default:
      return [];
  }
}
