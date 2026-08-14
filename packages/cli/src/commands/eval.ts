import os from 'node:os';
import path from 'node:path';

function flag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return (
    argv.includes(`--${name}`) ||
    argv.some((arg) => arg.startsWith(`--${name}=`))
  );
}

function defaultExecDir(identityDir: string): string {
  return path.join(
    os.homedir(),
    '.artificer',
    path.basename(path.resolve(identityDir)),
    'eval-runs',
  );
}

function positionalArgs(argv: string[]): string[] {
  return argv.filter((arg) => !arg.startsWith('--'));
}

export async function evalRun(argv: string[]): Promise<void> {
  const suite = flag(argv, 'suite') ?? 'smoke';
  const task = flag(argv, 'task');
  const preset = flag(argv, 'preset');
  const pack = flag(argv, 'pack');
  const limitRaw = flag(argv, 'limit');
  const identityDir = process.cwd();
  const { runIdentityEval } = await import('@artificer-ai/eval');
  const result = await runIdentityEval({
    identityDir,
    execDir: process.env.ARTIFICER_EXEC_DIR ?? defaultExecDir(identityDir),
    suiteId: pack || task ? undefined : suite,
    taskId: pack ? undefined : task,
    packId: pack,
    presetId: preset,
    limit: limitRaw ? Number(limitRaw) : undefined,
    llmJudge: hasFlag(argv, 'llm-judge'),
  });

  console.log(`Results: ${result.resultsDir}`);
}

export async function evalList(_argv: string[]): Promise<void> {
  const identityDir = process.cwd();
  const { listEvalSuites, listEvalTasks, listEvalPacks } =
    await import('@artificer-ai/eval');
  const [suites, tasks, packs] = await Promise.all([
    listEvalSuites(identityDir),
    listEvalTasks(identityDir),
    Promise.resolve(listEvalPacks()),
  ]);

  console.log(`Suites (${suites.length}):`);
  for (const suite of suites) {
    console.log(`  ${suite}`);
  }
  console.log(`Tasks (${tasks.length}):`);
  for (const task of tasks) {
    console.log(`  ${task}`);
  }
  console.log(`Packs (${packs.length}):`);
  for (const pack of packs) {
    console.log(`  ${pack.id}  ${pack.name}`);
  }
}

export async function evalCompare(argv: string[]): Promise<void> {
  const identityDir = process.cwd();
  const execDir = process.env.ARTIFICER_EXEC_DIR ?? defaultExecDir(identityDir);
  const writeSidecar = hasFlag(argv, 'write') || hasFlag(argv, 'sidecar');
  const positionals = positionalArgs(argv);

  const { compareEvalRuns, formatCompareTable, resolveCompareRunDirs } =
    await import('@artificer-ai/eval');

  const { baselineDir, candidateDir } = await resolveCompareRunDirs(
    execDir,
    positionals[0],
    positionals[1],
  );
  const result = await compareEvalRuns(baselineDir, candidateDir, {
    writeSidecar,
  });
  console.log(formatCompareTable(result));
  if (writeSidecar) {
    console.log(`Wrote ${path.join(candidateDir, 'compare.json')}`);
  }
}
