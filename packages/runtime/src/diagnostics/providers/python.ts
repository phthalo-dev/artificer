import path from 'node:path';
import { makeRegexParser, ruffJsonParser } from '../parsers.js';
import type { Diagnostic, LanguageProvider } from '../types.js';

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Python checker. Prefers `ruff` (fast, structured) when installed; otherwise
 * falls back to `python3 -m py_compile`, which at least surfaces syntax errors.
 */
export const pythonProvider: LanguageProvider = {
  id: 'python',
  matches(file) {
    return path.extname(file).toLowerCase() === '.py';
  },
  async isAvailable(ctx) {
    return (await ctx.which('ruff')) || (await ctx.which('python3'));
  },
  async diagnose(ctx): Promise<Diagnostic[]> {
    const files = ctx.files.map(shellQuote).join(' ');
    if (await ctx.which('ruff')) {
      const result = await ctx.exec(
        `ruff check --output-format json ${files}`,
      );
      return ruffJsonParser(result);
    }
    // py_compile prints "  File "<path>", line N" + a message on failure.
    const result = await ctx.exec(`python3 -m py_compile ${files}`);
    const parser = makeRegexParser(
      String.raw`File "(?<file>.+?)", line (?<line>\d+)`,
      'py_compile',
    );
    const parsed = parser(result);
    if (parsed.length > 0) return parsed;
    // Couldn't pin a location but the command failed — report the raw error.
    if (result.code !== 0) {
      const message = (result.stderr || result.stdout || 'py_compile failed')
        .trim()
        .split('\n')
        .slice(-3)
        .join('\n');
      return [{ file: '', severity: 'error', message, source: 'py_compile' }];
    }
    return [];
  },
};
