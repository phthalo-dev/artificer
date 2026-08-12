import type { UsageSummary } from './bench/types.js';

export type EvalTaskKind =
  | 'message'
  | 'workstream'
  | 'greenfield'
  | 'repo-patch';

export type EvalGrade =
  | { type: 'message-contains'; pattern: string }
  | { type: 'workstream-status'; expect: string[] }
  | { type: 'shell'; command: string; cwd?: string }
  | { type: 'file-exists'; path: string };

/** Pinned repository for `repo-patch` (and optional workstream context). */
export interface EvalRepoPin {
  /** Remote git URL, or the sentinel `"fixture"` for a vendored task fixture. */
  url: string;
  /** Commit SHA to check out, or `"local"` when `url` is `"fixture"`. */
  baseCommit: string;
  /** Optional subdirectory the agent / grader should focus on. */
  subpath?: string;
}

export interface EvalTaskManifest {
  id: string;
  title: string;
  kind: EvalTaskKind;
  tags?: string[];
  timeoutMs?: number;
  maxRuns?: number;
  test_command?: string;
  repo?: EvalRepoPin;
  grade: EvalGrade;
}

export interface EvalSuiteDefinition {
  name: string;
  description?: string;
  taskIds: string[];
}

export interface LoadedEvalTask {
  manifest: EvalTaskManifest;
  prompt: string;
  taskDir: string;
  fixtureDir?: string;
  hiddenDir?: string;
}

export interface EvalRunOptions {
  identityDir?: string;
  execDir?: string;
  suiteId?: string;
  taskId?: string;
  presetId?: string;
  resultsDir?: string;
  liveProgress?: boolean;
}

export interface EvalTaskResult {
  instanceId: string;
  outcome: 'submitted' | 'timeout' | 'failed' | 'error';
  durationMs: number;
  messageId?: string;
  outboundMessages: string[];
  usage?: UsageSummary;
  resolved?: boolean;
}

const EVAL_TASK_KINDS = new Set<EvalTaskKind>([
  'message',
  'workstream',
  'greenfield',
  'repo-patch',
]);

/** Sentinel `repo.url` for Pack A-style vendored fixture snapshots. */
export const FIXTURE_REPO_URL = 'fixture';

function requireObject(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${label} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function requireStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array of strings`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error(`${key} must be a non-empty array of strings`);
    }
  }
  return value;
}

function parseOptionalStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (obj[key] === undefined) return undefined;
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error(`${key} must be an array of non-empty strings`);
    }
  }
  return value;
}

function parseEvalRepo(raw: unknown): EvalRepoPin {
  const obj = requireObject(raw, 'repo');
  const repo: EvalRepoPin = {
    url: requireString(obj, 'url'),
    baseCommit: requireString(obj, 'baseCommit'),
  };
  if (obj.subpath !== undefined) {
    repo.subpath = requireString(obj, 'subpath');
  }
  return repo;
}

function parseEvalGrade(raw: unknown): EvalGrade {
  const obj = requireObject(raw, 'grade');
  const type = requireString(obj, 'type');

  switch (type) {
    case 'message-contains':
      return { type, pattern: requireString(obj, 'pattern') };
    case 'workstream-status':
      return { type, expect: requireStringArray(obj, 'expect') };
    case 'shell': {
      const grade: { type: 'shell'; command: string; cwd?: string } = {
        type,
        command: requireString(obj, 'command'),
      };
      if (obj.cwd !== undefined) {
        grade.cwd = requireString(obj, 'cwd');
      }
      return grade;
    }
    case 'file-exists':
      return { type, path: requireString(obj, 'path') };
    default:
      throw new Error(`Unknown eval grade type: ${type}`);
  }
}

export function parseEvalTaskManifest(raw: unknown): EvalTaskManifest {
  const obj = requireObject(raw, 'Eval task manifest');
  const id = requireString(obj, 'id');
  const title = requireString(obj, 'title');
  const kind = requireString(obj, 'kind');

  if (!EVAL_TASK_KINDS.has(kind as EvalTaskKind)) {
    throw new Error(`Unknown eval task kind: ${kind}`);
  }

  const manifest: EvalTaskManifest = {
    id,
    title,
    kind: kind as EvalTaskKind,
    grade: parseEvalGrade(obj.grade),
  };

  if (obj.timeoutMs !== undefined) {
    manifest.timeoutMs = requireNumber(obj, 'timeoutMs');
  }
  if (obj.maxRuns !== undefined) {
    manifest.maxRuns = requireNumber(obj, 'maxRuns');
  }
  if (obj.test_command !== undefined) {
    manifest.test_command = requireString(obj, 'test_command');
  }
  const tags = parseOptionalStringArray(obj, 'tags');
  if (tags) manifest.tags = tags;

  if (obj.repo !== undefined) {
    manifest.repo = parseEvalRepo(obj.repo);
  }

  if (manifest.kind === 'repo-patch') {
    if (!manifest.repo) {
      throw new Error('repo-patch tasks require repo.url and repo.baseCommit');
    }
  }

  return manifest;
}

export function parseEvalSuite(raw: unknown): EvalSuiteDefinition {
  const obj = requireObject(raw, 'Eval suite');
  const name = requireString(obj, 'name');
  const taskIds = requireStringArray(obj, 'taskIds');

  const suite: EvalSuiteDefinition = { name, taskIds };
  if (obj.description !== undefined) {
    suite.description = requireString(obj, 'description');
  }
  return suite;
}
