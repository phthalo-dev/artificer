export const HISTORY_SOURCES = [
  'claude-code',
  'cursor',
  'codex',
  'opencode',
] as const;

export type HistorySource = (typeof HISTORY_SOURCES)[number];

export interface SessionListing {
  source: HistorySource;
  id: string;
  path: string;
  cwd?: string;
  updatedAt?: string;
}

export interface ParsedSession {
  source: HistorySource;
  id: string;
  path: string;
  cwd?: string;
  userTexts: string[];
}

export interface MemoryDraft {
  content: string;
  title: string;
  summary: string;
  tags: string[];
  kind: 'preference';
  source: string;
  sourceHash: string;
}

export interface HistoryImportPlan {
  scanned: number;
  skippedSessions: number;
  drafts: MemoryDraft[];
  skippedExisting: number;
}
