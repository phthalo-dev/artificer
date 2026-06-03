import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { diagnoseEdited } from './diagnose.js';
import { resolveScoped } from './files.js';

/**
 * A replacer yields candidate substrings of `content` that could correspond to
 * `find`. The cascade tries each replacer in order; the first one that produces
 * a unique match wins. Ported from opencode's edit tool (which credits Cline's
 * diff-apply and Gemini's edit corrector).
 */
export type Replacer = (
  content: string,
  find: string,
) => Generator<string, void, unknown>;

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

function levenshtein(a: string, b: string): number {
  if (a === '' || b === '') return Math.max(a.length, b.length);
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

/** Exact substring match. */
export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

/** Match a block where each line is equal after trimming leading/trailing ws. */
export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    let startIndex = 0;
    for (let k = 0; k < i; k++) startIndex += originalLines[k].length + 1;
    let endIndex = startIndex;
    for (let k = 0; k < searchLines.length; k++) {
      endIndex += originalLines[i + k].length;
      if (k < searchLines.length - 1) endIndex += 1;
    }
    yield content.substring(startIndex, endIndex);
  }
};

/** Collapse runs of whitespace; matches single-line and multi-line blocks. */
export const WhitespaceNormalizedReplacer: Replacer = function* (
  content,
  find,
) {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalize(find);

  const lines = content.split('\n');
  for (const line of lines) {
    if (normalize(line) === normalizedFind) {
      yield line;
    } else if (normalize(line).includes(normalizedFind)) {
      const words = find.trim().split(/\s+/);
      if (words.length > 0) {
        const pattern = words
          .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s+');
        try {
          const match = line.match(new RegExp(pattern));
          if (match) yield match[0];
        } catch {
          // invalid regex, skip
        }
      }
    }
  }

  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length);
      if (normalize(block.join('\n')) === normalizedFind) yield block.join('\n');
    }
  }
};

/** Strip the common minimum indentation from the search block and file slices. */
export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const dedent = (text: string) => {
    const lines = text.split('\n');
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) return text;
    const minIndent = Math.min(
      ...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1].length ?? 0),
    );
    return lines
      .map((l) => (l.trim().length === 0 ? l : l.slice(minIndent)))
      .join('\n');
  };

  const normalizedFind = dedent(find);
  const contentLines = content.split('\n');
  const findLines = find.split('\n');
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n');
    if (dedent(block) === normalizedFind) yield block;
  }
};

/**
 * For blocks of 3+ lines, anchor on the first and last line (trimmed) and score
 * the middle lines by Levenshtein similarity. Tolerates drift in the interior.
 */
export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');
  if (searchLines.length < 3) return;
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();

  const firstLine = searchLines[0].trim();
  const lastLine = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLine) continue;
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLine) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }
  if (candidates.length === 0) return;

  const sliceOf = (startLine: number, endLine: number) => {
    let startIndex = 0;
    for (let k = 0; k < startLine; k++) startIndex += originalLines[k].length + 1;
    let endIndex = startIndex;
    for (let k = startLine; k <= endLine; k++) {
      endIndex += originalLines[k].length;
      if (k < endLine) endIndex += 1;
    }
    return content.substring(startIndex, endIndex);
  };

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    const actualBlockSize = endLine - startLine + 1;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
    let similarity = 0;
    if (linesToCheck > 0) {
      for (
        let j = 1;
        j < searchBlockSize - 1 && j < actualBlockSize - 1;
        j++
      ) {
        const orig = originalLines[startLine + j].trim();
        const search = searchLines[j].trim();
        const maxLen = Math.max(orig.length, search.length);
        if (maxLen === 0) continue;
        similarity += (1 - levenshtein(orig, search) / maxLen) / linesToCheck;
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) break;
      }
    } else {
      similarity = 1.0;
    }
    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      yield sliceOf(startLine, endLine);
    }
    return;
  }

  let bestMatch: { startLine: number; endLine: number } | null = null;
  let maxSimilarity = -1;
  for (const candidate of candidates) {
    const { startLine, endLine } = candidate;
    const actualBlockSize = endLine - startLine + 1;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
    let similarity = 0;
    if (linesToCheck > 0) {
      for (
        let j = 1;
        j < searchBlockSize - 1 && j < actualBlockSize - 1;
        j++
      ) {
        const orig = originalLines[startLine + j].trim();
        const search = searchLines[j].trim();
        const maxLen = Math.max(orig.length, search.length);
        if (maxLen === 0) continue;
        similarity += 1 - levenshtein(orig, search) / maxLen;
      }
      similarity /= linesToCheck;
    } else {
      similarity = 1.0;
    }
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatch = candidate;
    }
  }
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    yield sliceOf(bestMatch.startLine, bestMatch.endLine);
  }
};

const REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  BlockAnchorReplacer,
];

/**
 * Replace `oldString` with `newString` in `content`. Tries each replacer in the
 * cascade; the first that yields a uniquely-locatable match is used. With
 * `replaceAll`, every occurrence of the first matched form is replaced.
 *
 * Operates on LF-normalized text — callers handle CRLF conversion.
 */
export function replace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string {
  if (oldString === newString) {
    throw new Error(
      'No changes to apply: old_string and new_string are identical.',
    );
  }

  let notFound = true;
  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;
      if (replaceAll) return content.replaceAll(search, newString);
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue;
      return (
        content.substring(0, index) +
        newString +
        content.substring(index + search.length)
      );
    }
  }

  if (notFound) {
    throw new Error(
      'Could not find old_string in the file. It must match the existing text (whitespace, indentation, and line endings included). Read the file again and copy the exact text.',
    );
  }
  throw new Error(
    'Found multiple matches for old_string. Add more surrounding context so it identifies exactly one location, or set replace_all to true.',
  );
}

/** Detect the dominant line ending so edits round-trip CRLF files cleanly. */
function detectEol(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

const toLf = (text: string) => text.replace(/\r\n/g, '\n');

export function createEditTool(ctx: ToolContext): ToolDef[] {
  const { workspaceDir } = ctx;

  return [
    {
      name: 'edit_file',
      description:
        'Make a targeted edit to an existing file by replacing old_string with new_string. Prefer this over write_file for changes to existing files — it avoids re-sending the whole file. old_string must uniquely identify the text to replace (include enough surrounding context). Never use run_shell (sed/perl/python) to edit files. To create a new file, pass an empty old_string.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative file path.',
          },
          old_string: {
            type: 'string',
            description:
              'The exact text to replace. Empty string creates/overwrites the file with new_string.',
          },
          new_string: {
            type: 'string',
            description: 'The replacement text.',
          },
          replace_all: {
            type: 'boolean',
            description:
              'Replace every occurrence of old_string instead of requiring a single unique match. Defaults to false.',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      handler: async (input) => {
        const rel = String(input.path);
        const target = resolveScoped(workspaceDir, rel);
        const oldString = String(input.old_string ?? '');
        const newString = String(input.new_string ?? '');
        const replaceAll = Boolean(input.replace_all);

        if (oldString === '') {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, newString, 'utf8');
          return `Wrote ${rel}${await diagnoseEdited(ctx, [rel])}`;
        }

        const original = await fs.readFile(target, 'utf8');
        const eol = detectEol(original);
        const updated = replace(
          toLf(original),
          toLf(oldString),
          toLf(newString),
          replaceAll,
        );
        const out = eol === '\r\n' ? updated.replace(/\n/g, '\r\n') : updated;
        await fs.writeFile(target, out, 'utf8');
        return `Edited ${rel}${await diagnoseEdited(ctx, [rel])}`;
      },
    },
  ];
}
