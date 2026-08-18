import { createHash } from 'node:crypto';
import { listSessions, type ListSessionsOptions } from './discover.js';
import { extractPreferences, normalizeKey } from './extract.js';
import { parseSession } from './parse.js';
import type { HistoryImportPlan, HistorySource, MemoryDraft } from './types.js';
import { IdentityStore } from '../storage/identity-store.js';
import type { Memory } from '../storage/types.js';

export type PlanHistoryImportOptions = ListSessionsOptions & {
  identityDir: string;
};

export async function planHistoryImport(
  options: PlanHistoryImportOptions,
): Promise<HistoryImportPlan> {
  const listings = listSessions(options);
  const existing = await loadExistingHashes(options.identityDir);
  const seen = new Set<string>(existing);
  const drafts: MemoryDraft[] = [];
  let skippedSessions = 0;
  let skippedExisting = 0;

  for (const listing of listings) {
    let parsed;
    try {
      parsed = parseSession(listing);
    } catch {
      skippedSessions += 1;
      continue;
    }
    if (parsed.userTexts.length === 0) {
      skippedSessions += 1;
      continue;
    }

    const preferences = extractPreferences(parsed.userTexts);
    if (preferences.length === 0) {
      skippedSessions += 1;
      continue;
    }

    for (const content of preferences) {
      const sourceHash = hashPreference(content);
      if (seen.has(sourceHash)) {
        skippedExisting += 1;
        continue;
      }
      seen.add(sourceHash);
      drafts.push(toDraft(content, parsed.source, parsed.id, sourceHash));
    }
  }

  return {
    scanned: listings.length,
    skippedSessions,
    drafts,
    skippedExisting,
  };
}

export async function applyHistoryImport(
  identityDir: string,
  drafts: MemoryDraft[],
): Promise<Memory[]> {
  const store = new IdentityStore(identityDir);
  await store.init();
  const written: Memory[] = [];
  for (const draft of drafts) {
    written.push(
      await store.addMemory({
        content: draft.content,
        title: draft.title,
        summary: draft.summary,
        tags: draft.tags,
        kind: draft.kind,
        source: draft.source,
        sourceHash: draft.sourceHash,
      }),
    );
  }
  return written;
}

async function loadExistingHashes(identityDir: string): Promise<Set<string>> {
  const store = new IdentityStore(identityDir);
  const hashes = new Set<string>();
  try {
    for (const memory of await store.listMemories()) {
      if (memory.sourceHash) hashes.add(memory.sourceHash);
      hashes.add(hashPreference(memory.content));
    }
  } catch {
    return hashes;
  }
  return hashes;
}

function toDraft(
  content: string,
  source: HistorySource,
  sessionId: string,
  sourceHash: string,
): MemoryDraft {
  const title = titleFrom(content);
  return {
    content,
    title,
    summary: title,
    tags: ['imported', source],
    kind: 'preference',
    source: `import:${source}:${sessionId}`,
    sourceHash,
  };
}

function titleFrom(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= 72) return compact;
  return `${compact.slice(0, 71).trimEnd()}…`;
}

function hashPreference(content: string): string {
  return createHash('sha256').update(normalizeKey(content)).digest('hex');
}
