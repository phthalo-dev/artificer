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

function defaultExecDir(identityDir: string): string {
  return path.join(
    os.homedir(),
    '.artificer',
    path.basename(path.resolve(identityDir)),
    'eval-runs',
  );
}

export async function evalRun(argv: string[]): Promise<void> {
  const suite = flag(argv, 'suite') ?? 'smoke';
  const task = flag(argv, 'task');
  const preset = flag(argv, 'preset');
  const identityDir = process.cwd();
  const { runIdentityEval } = await import('@artificer-ai/eval');
  const result = await runIdentityEval({
    identityDir,
    execDir: process.env.ARTIFICER_EXEC_DIR ?? defaultExecDir(identityDir),
    suiteId: task ? undefined : suite,
    taskId: task,
    presetId: preset,
  });

  console.log(`Results: ${result.resultsDir}`);
}

export async function evalList(_argv: string[]): Promise<void> {
  const identityDir = process.cwd();
  const { listEvalSuites, listEvalTasks } = await import('@artificer-ai/eval');
  const [suites, tasks] = await Promise.all([
    listEvalSuites(identityDir),
    listEvalTasks(identityDir),
  ]);

  console.log(`Suites (${suites.length}):`);
  for (const suite of suites) {
    console.log(`  ${suite}`);
  }
  console.log(`Tasks (${tasks.length}):`);
  for (const task of tasks) {
    console.log(`  ${task}`);
  }
}
