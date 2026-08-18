import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HISTORY_SOURCES,
  type HistorySource,
  type SessionListing,
} from './types.js';

export interface ListSessionsOptions {
  sources?: HistorySource[];
  roots?: Partial<Record<HistorySource, string>>;
  projectDir?: string;
}

export function defaultSessionRoots(): Record<HistorySource, string> {
  const home = os.homedir();
  const xdgData =
    process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  return {
    'claude-code': path.join(home, '.claude', 'projects'),
    cursor: path.join(home, '.cursor', 'projects'),
    codex: path.join(home, '.codex', 'sessions'),
    opencode: path.join(xdgData, 'opencode'),
  };
}

export function listSessions(
  options: ListSessionsOptions = {},
): SessionListing[] {
  const sources = options.sources?.length
    ? options.sources
    : [...HISTORY_SOURCES];
  const defaults = defaultSessionRoots();
  const items: SessionListing[] = [];
  for (const source of sources) {
    const root = options.roots?.[source] ?? defaults[source];
    items.push(...listSource(source, root));
  }
  return items.filter((item) => matchesProject(item, options.projectDir));
}

function listSource(source: HistorySource, root: string): SessionListing[] {
  const facts = safeStat(root);
  if (!facts) return [];
  if (facts.isFile) {
    return listingFromFile(source, root)
      ? [listingFromFile(source, root)!]
      : [];
  }

  switch (source) {
    case 'claude-code':
      return listClaudeCode(root);
    case 'cursor':
      return listCursor(root);
    case 'codex':
      return listCodex(root);
    case 'opencode':
      return listOpenCode(root);
  }
}

function listClaudeCode(root: string): SessionListing[] {
  const items: SessionListing[] = [];
  for (const project of safeReadDir(root)) {
    if (!project.isDirectory) continue;
    const projectPath = path.join(root, project.name);
    for (const entry of safeReadDir(projectPath)) {
      if (!entry.isFile || !entry.name.endsWith('.jsonl')) continue;
      if (entry.name.startsWith('agent-')) continue;
      const listing = listingFromFile(
        'claude-code',
        path.join(projectPath, entry.name),
      );
      if (listing) items.push(listing);
    }
  }
  return items;
}

function listCursor(root: string): SessionListing[] {
  const items: SessionListing[] = [];
  for (const file of collectFiles(root, '.jsonl', 5)) {
    if (!file.includes(`${path.sep}agent-transcripts${path.sep}`)) continue;
    const listing = listingFromFile('cursor', file);
    if (listing) items.push(listing);
  }
  return items;
}

function listCodex(root: string): SessionListing[] {
  const items: SessionListing[] = [];
  for (const file of collectFiles(root, '.jsonl', 4)) {
    const listing = listingFromFile('codex', file);
    if (listing) items.push(listing);
  }
  return items;
}

function listOpenCode(root: string): SessionListing[] {
  const items: SessionListing[] = [];
  const storageSessions = path.join(root, 'storage', 'session');
  for (const file of collectFiles(storageSessions, '.json', 2)) {
    const listing = listingFromFile('opencode', file, readOpenCodeMeta(file));
    if (listing) items.push(listing);
  }
  for (const entry of safeReadDir(root)) {
    if (!entry.isFile || !entry.name.endsWith('.json')) continue;
    const file = path.join(root, entry.name);
    const meta = readOpenCodeExportMeta(file);
    if (!meta) continue;
    const listing = listingFromFile('opencode', file, meta);
    if (listing) items.push(listing);
  }
  return items;
}

function listingFromFile(
  source: HistorySource,
  filePath: string,
  meta?: { id?: string; cwd?: string },
): SessionListing | undefined {
  const facts = safeStat(filePath);
  if (!facts?.isFile) return undefined;
  return {
    source,
    id: meta?.id || path.basename(filePath, path.extname(filePath)),
    path: filePath,
    cwd: meta?.cwd,
    updatedAt: new Date(facts.mtimeMs).toISOString(),
  };
}

function readOpenCodeExportMeta(
  file: string,
): { id?: string; cwd?: string } | undefined {
  const value = readJson(file);
  if (!isObject(value) || !Array.isArray(value.messages)) return undefined;
  const info = isObject(value.info) ? value.info : {};
  return {
    id: nonempty(info.id),
    cwd: nonempty(info.directory),
  };
}

function readOpenCodeMeta(file: string): { id?: string; cwd?: string } {
  const value = readJson(file);
  if (!isObject(value)) return {};
  const info = isObject(value.info) ? value.info : value;
  return {
    id: nonempty(info.id) ?? nonempty(value.id),
    cwd: nonempty(info.directory) ?? nonempty(value.directory),
  };
}

function matchesProject(
  listing: SessionListing,
  projectDir: string | undefined,
): boolean {
  if (!projectDir) return true;
  const resolved = path.resolve(projectDir);
  if (listing.cwd) {
    const cwd = path.resolve(listing.cwd);
    if (cwd === resolved || cwd.startsWith(resolved + path.sep)) return true;
  }
  const encoded = resolved.replace(/[^A-Za-z0-9]/g, '-');
  const encodedCursor = encoded.replace(/^-+/, '');
  return listing.path.includes(encoded) || listing.path.includes(encodedCursor);
}

function collectFiles(
  root: string,
  extension: string,
  depth: number,
): string[] {
  if (depth < 0) return [];
  const collected: string[] = [];
  for (const entry of safeReadDir(root)) {
    const full = path.join(root, entry.name);
    if (entry.isFile && entry.name.endsWith(extension)) {
      collected.push(full);
    } else if (entry.isDirectory) {
      collected.push(...collectFiles(full, extension, depth - 1));
    }
  }
  return collected;
}

function safeReadDir(
  dir: string,
): { name: string; isDirectory: boolean; isFile: boolean }[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  } catch {
    return [];
  }
}

function safeStat(
  target: string,
): { isFile: boolean; isDirectory: boolean; mtimeMs: number } | undefined {
  try {
    const stats = fs.statSync(target);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
