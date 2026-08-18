import fs from 'node:fs';
import path from 'node:path';
import { unwrapUserText } from './extract.js';
import type { ParsedSession, SessionListing } from './types.js';

const CLAUDE_NOISE_PREFIXES = [
  '<local-command-caveat>',
  '<command-name>',
  '<command-message>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<task-notification',
];

const CODEX_INJECTED_PREFIXES = [
  '<environment_context>',
  '<user_instructions>',
  '<permissions instructions>',
  '<turn_context>',
];

export function parseSession(listing: SessionListing): ParsedSession {
  const raw = fs.readFileSync(listing.path, 'utf-8');
  switch (listing.source) {
    case 'claude-code':
      return parseClaudeCode(listing, raw);
    case 'cursor':
      return parseCursor(listing, raw);
    case 'codex':
      return parseCodex(listing, raw);
    case 'opencode':
      return parseOpenCode(listing, raw);
  }
}

function parseClaudeCode(listing: SessionListing, raw: string): ParsedSession {
  const userTexts: string[] = [];
  let cwd = listing.cwd;
  let id = listing.id;

  for (const row of parseJsonLines(raw)) {
    if (typeof row.cwd === 'string' && row.cwd && !cwd) cwd = row.cwd;
    if (typeof row.sessionId === 'string' && row.sessionId) id = row.sessionId;
    if (row.type !== 'user') continue;
    if (row.isSidechain === true) continue;
    if (!isObject(row.message)) continue;
    const text = claudeUserText(row.message.content);
    if (text) userTexts.push(text);
  }

  return { source: 'claude-code', id, path: listing.path, cwd, userTexts };
}

function parseCursor(listing: SessionListing, raw: string): ParsedSession {
  const userTexts: string[] = [];
  for (const row of parseJsonLines(raw)) {
    if (row.role !== 'user' || !isObject(row.message)) continue;
    const text = unwrapUserText(contentText(row.message.content));
    if (text) userTexts.push(text);
  }
  return {
    source: 'cursor',
    id: listing.id,
    path: listing.path,
    cwd: listing.cwd,
    userTexts,
  };
}

function parseCodex(listing: SessionListing, raw: string): ParsedSession {
  const userTexts: string[] = [];
  let cwd = listing.cwd;
  let id = listing.id;

  for (const row of parseJsonLines(raw)) {
    const payload = isObject(row.payload) ? row.payload : {};
    if (row.type === 'session_meta') {
      if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
      if (typeof payload.id === 'string' && payload.id) id = payload.id;
      continue;
    }
    if (row.type === 'turn_context' && typeof payload.cwd === 'string') {
      cwd ??= payload.cwd;
      continue;
    }
    if (row.type !== 'response_item' || payload.type !== 'message') continue;
    if (payload.role !== 'user') continue;
    const text = contentText(payload.content).trim();
    if (!text) continue;
    if (
      CODEX_INJECTED_PREFIXES.some((prefix) =>
        text.trimStart().startsWith(prefix),
      )
    ) {
      continue;
    }
    userTexts.push(text);
  }

  return { source: 'codex', id, path: listing.path, cwd, userTexts };
}

function parseOpenCode(listing: SessionListing, raw: string): ParsedSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySession(listing);
  }
  if (!isObject(parsed)) return emptySession(listing);

  if (Array.isArray(parsed.messages)) {
    return parseOpenCodeDocument(listing, parsed);
  }

  return parseOpenCodeStore(listing, parsed);
}

function parseOpenCodeDocument(
  listing: SessionListing,
  document: Record<string, unknown>,
): ParsedSession {
  const info = isObject(document.info) ? document.info : {};
  const id = nonempty(info.id) ?? nonempty(document.id) ?? listing.id;
  const cwd = nonempty(info.directory) ?? listing.cwd;
  const userTexts: string[] = [];

  for (const message of document.messages as unknown[]) {
    if (!isObject(message)) continue;
    const msgInfo = isObject(message.info) ? message.info : message;
    if (msgInfo.role !== 'user') continue;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const texts = parts
      .filter((part) => isObject(part) && part.type === 'text')
      .map((part) =>
        typeof (part as { text?: unknown }).text === 'string'
          ? ((part as { text: string }).text as string)
          : '',
      )
      .filter(Boolean);
    if (texts.length) userTexts.push(texts.join('\n'));
  }

  return { source: 'opencode', id, path: listing.path, cwd, userTexts };
}

function parseOpenCodeStore(
  listing: SessionListing,
  info: Record<string, unknown>,
): ParsedSession {
  const id = nonempty(info.id) ?? listing.id;
  const cwd = nonempty(info.directory) ?? listing.cwd;
  const storageRoot = findOpenCodeStorageRoot(listing.path);
  if (!storageRoot) {
    return { source: 'opencode', id, path: listing.path, cwd, userTexts: [] };
  }

  const userTexts: string[] = [];
  const messagesDir = path.join(storageRoot, 'message', id);
  for (const messageFile of listJsonFiles(messagesDir)) {
    const message = readJsonObject(messageFile);
    if (!message) continue;
    const role =
      nonempty(message.role) ??
      (isObject(message.info) ? nonempty(message.info.role) : undefined);
    if (role !== 'user') continue;
    const messageId =
      nonempty(message.id) ?? path.basename(messageFile, '.json');
    const partsDir = path.join(storageRoot, 'part', messageId);
    const texts: string[] = [];
    for (const partFile of listJsonFiles(partsDir)) {
      const part = readJsonObject(partFile);
      if (!part || part.type !== 'text') continue;
      if (typeof part.text === 'string' && part.text) texts.push(part.text);
    }
    if (typeof message.content === 'string' && message.content) {
      texts.push(message.content);
    }
    if (texts.length) userTexts.push(texts.join('\n'));
  }

  return { source: 'opencode', id, path: listing.path, cwd, userTexts };
}

function claudeUserText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const text = content.trim();
    if (!text) return undefined;
    if (CLAUDE_NOISE_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      return undefined;
    }
    return text;
  }
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === 'tool_result') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  const text = parts.join('\n').trim();
  if (!text) return undefined;
  if (CLAUDE_NOISE_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return undefined;
  }
  return text;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!isObject(item)) continue;
    if (
      (item.type === 'text' ||
        item.type === 'input_text' ||
        item.type === 'output_text' ||
        item.type === undefined) &&
      typeof item.text === 'string'
    ) {
      parts.push(item.text);
    }
  }
  return parts.join('\n');
}

function parseJsonLines(raw: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isObject(value)) rows.push(value);
    } catch {
      // Skip malformed lines; session stores are append-only and occasionally dirty.
    }
  }
  return rows;
}

function findOpenCodeStorageRoot(sessionPath: string): string | undefined {
  const dir = path.dirname(sessionPath);
  if (path.basename(path.dirname(dir)) === 'session') {
    return path.dirname(path.dirname(dir));
  }
  if (path.basename(dir) === 'storage') return dir;
  return undefined;
}

function listJsonFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(dir, name))
      .sort();
  } catch {
    return [];
  }
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function emptySession(listing: SessionListing): ParsedSession {
  return {
    source: listing.source,
    id: listing.id,
    path: listing.path,
    cwd: listing.cwd,
    userTexts: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
