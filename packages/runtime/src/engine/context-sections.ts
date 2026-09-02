import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ContextSectionId =
  | 'findings'
  | 'recent_tasks'
  | 'git_status'
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
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`);
  } catch (err) {
    console.warn(
      `[artificer] failed to save context sections to ${filePath}:`,
      err,
    );
  }
}

export async function renderSection(args: {
  id: ContextSectionId;
  filePath: string;
  compute: () => string | Promise<string>;
  now?: () => string;
}): Promise<{ body: string; updated: boolean }> {
  const body = await args.compute();
  const hash = shortHash(body);
  const file = loadContextSections(args.filePath);
  const previous = file.sections[args.id];
  if (previous && previous.hash === hash) {
    return { body: previous.body, updated: false };
  }
  const now = args.now ?? (() => new Date().toISOString());
  file.sections[args.id] = { hash, body, updatedAt: now() };
  saveContextSections(args.filePath, file);
  return { body, updated: true };
}

export function formatSectionsFooter(updatedIds: ContextSectionId[]): string {
  if (updatedIds.length === 0) return '[context sections: all unchanged]';
  return `[context sections updated: ${updatedIds.join(', ')}]`;
}
