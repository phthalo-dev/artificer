import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ContextSectionId =
  | 'findings'
  | 'recent_tasks'
  | 'git_status'
  | 'git_status_diff'
  | 'prior_runs'
  | 'file_cache'
  | 'memory_signpost';

export type ContextSectionSnapshot = {
  hash: string;
  body: string;
  updatedAt: string;
};

export type ContextSectionsFile = {
  version: 1;
  sections: Partial<Record<ContextSectionId, ContextSectionSnapshot>>;
};

export type RenderedSection = {
  id: ContextSectionId;
  body: string;
  updated: boolean;
};

function emptyFile(): ContextSectionsFile {
  return { version: 1, sections: {} };
}

export function shortHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16);
}

function isSnapshot(value: unknown): value is ContextSectionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.hash === 'string' &&
    typeof rec.body === 'string' &&
    typeof rec.updatedAt === 'string'
  );
}

export function loadContextSections(filePath: string): ContextSectionsFile {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyFile();
    const rec = parsed as Record<string, unknown>;
    if (
      rec.version !== 1 ||
      !rec.sections ||
      typeof rec.sections !== 'object'
    ) {
      return emptyFile();
    }
    const sections: ContextSectionsFile['sections'] = {};
    for (const [id, snapshot] of Object.entries(
      rec.sections as Record<string, unknown>,
    )) {
      if (isSnapshot(snapshot)) {
        sections[id as ContextSectionId] = snapshot;
      }
    }
    return { version: 1, sections };
  } catch {
    return emptyFile();
  }
}

export function saveContextSections(
  filePath: string,
  file: ContextSectionsFile,
): void {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of a leftover temp file.
    }
    console.warn(
      `[artificer] failed to save context sections to ${filePath}:`,
      err,
    );
  }
}

export async function renderSections(args: {
  filePath: string;
  items: Array<{
    id: ContextSectionId;
    compute: () => string | Promise<string>;
  }>;
  now?: () => string;
}): Promise<RenderedSection[]> {
  const file = loadContextSections(args.filePath);
  const now = args.now ?? (() => new Date().toISOString());
  const results: RenderedSection[] = [];
  let dirty = false;
  for (const item of args.items) {
    const body = await item.compute();
    const hash = shortHash(body);
    const previous = file.sections[item.id];
    if (previous && previous.hash === hash) {
      results.push({ id: item.id, body: previous.body, updated: false });
      continue;
    }
    file.sections[item.id] = { hash, body, updatedAt: now() };
    dirty = true;
    results.push({ id: item.id, body, updated: true });
  }
  if (dirty) saveContextSections(args.filePath, file);
  return results;
}

export async function renderSection(args: {
  id: ContextSectionId;
  filePath: string;
  compute: () => string | Promise<string>;
  now?: () => string;
}): Promise<{ body: string; updated: boolean }> {
  const [result] = await renderSections({
    filePath: args.filePath,
    now: args.now,
    items: [{ id: args.id, compute: args.compute }],
  });
  return result ?? { body: '', updated: true };
}

export function formatSectionsFooter(updatedIds: ContextSectionId[]): string {
  if (updatedIds.length === 0) return '[context sections: all unchanged]';
  return `[context sections updated: ${updatedIds.join(', ')}]`;
}
