import path from 'node:path';
import {
  applyHistoryImport,
  HISTORY_SOURCES,
  planHistoryImport,
  type HistorySource,
  type PlanHistoryImportOptions,
} from '@artificer-ai/runtime';

export function usage(): string {
  return [
    'Usage: artificer import-history [options]',
    '',
    'Scan local coding-agent session logs and extract standing preferences',
    '(always/never instructions) into identity/memories/. Default is dry-run.',
    '',
    'Options:',
    '  --apply                 Write memories (default: dry-run)',
    '  --source <name>         claude-code, cursor, codex, opencode (repeatable)',
    '  --project <dir>         Only sessions for this project directory',
    '  --identity-dir <dir>    Identity repo root (default: cwd)',
    "  --root <source>:<path>  Override a source's local session store",
  ].join('\n');
}

export async function importHistory(argv: string[]): Promise<void> {
  if (hasFlag(argv, 'help')) {
    console.log(usage());
    return;
  }

  const identityDir = path.resolve(flag(argv, 'identity-dir') ?? process.cwd());
  const project = flag(argv, 'project');
  const sources = parseSources(repeatFlag(argv, 'source'));
  const roots = parseRoots(repeatFlag(argv, 'root'));
  const apply = hasFlag(argv, 'apply');

  const options: PlanHistoryImportOptions = {
    identityDir,
    sources,
    roots,
    projectDir: project ? path.resolve(project) : undefined,
  };

  const plan = await planHistoryImport(options);
  const sourceLabel = (sources ?? [...HISTORY_SOURCES]).join(', ');
  console.log(`Scanned ${plan.scanned} session(s) (${sourceLabel}).`);
  if (plan.skippedExisting > 0) {
    console.log(`Skipped ${plan.skippedExisting} already imported.`);
  }

  if (plan.drafts.length === 0) {
    console.log('No standing preferences found in scanned sessions.');
    return;
  }

  for (const draft of plan.drafts) {
    console.log(`- ${draft.content}`);
    console.log(`  source: ${draft.source}`);
  }

  if (!apply) {
    console.log('');
    console.log(
      `Dry-run: ${plan.drafts.length} preference memories. Re-run with --apply to write identity/memories/.`,
    );
    return;
  }

  const written = await applyHistoryImport(identityDir, plan.drafts);
  const noun = written.length === 1 ? 'memory' : 'memories';
  console.log(`Wrote ${written.length} ${noun} to identity/memories/.`);
}

function parseSources(raw: string[]): HistorySource[] | undefined {
  if (raw.length === 0) return undefined;
  const values = raw
    .flatMap((value) => value.split(','))
    .map((value) => value.trim());
  const unknown = values.filter(
    (value) => !HISTORY_SOURCES.includes(value as HistorySource),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown source ${JSON.stringify(unknown.join(', '))}. Supported: ${HISTORY_SOURCES.join(', ')}.`,
    );
  }
  return values as HistorySource[];
}

function parseRoots(raw: string[]): PlanHistoryImportOptions['roots'] {
  if (raw.length === 0) return undefined;
  const roots: NonNullable<PlanHistoryImportOptions['roots']> = {};
  for (const value of raw) {
    const split = value.indexOf(':');
    if (split <= 0) {
      throw new Error(
        `Invalid --root ${JSON.stringify(value)}. Expected source:path (e.g. claude-code:~/.claude/projects).`,
      );
    }
    const source = value.slice(0, split);
    const rootPath = value.slice(split + 1);
    if (!HISTORY_SOURCES.includes(source as HistorySource)) {
      throw new Error(
        `Unknown source ${JSON.stringify(source)}. Supported: ${HISTORY_SOURCES.join(', ')}.`,
      );
    }
    roots[source as HistorySource] = path.resolve(rootPath);
  }
  return roots;
}

function flag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function repeatFlag(argv: string[], name: string): string[] {
  const values: string[] = [];
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
      continue;
    }
    if (arg === `--${name}`) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) values.push(next);
    }
  }
  return values;
}

function hasFlag(argv: string[], name: string): boolean {
  return (
    argv.includes(`--${name}`) ||
    argv.some((arg) => arg.startsWith(`--${name}=`))
  );
}
