import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import type { EvalTaskResult } from '../types.js';
import type { EvalRuntimeHandle } from './runtime.js';
import { runIdentityEval } from './run-suite.js';

const result = (instanceId: string, resolved: boolean): EvalTaskResult => ({
  instanceId,
  outcome: resolved ? 'submitted' : 'failed',
  durationMs: 10,
  outboundMessages: [],
  resolved,
});

test('runIdentityEval dispatches a suite and writes reusable result artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-suite-'));
  const identityDir = path.join(root, 'identity');
  const execDir = path.join(root, 'exec');
  const resultsDir = path.join(root, 'results');
  const evalsDir = path.join(identityDir, 'agent', 'evals');

  await fs.mkdir(path.join(evalsDir, 'suites'), { recursive: true });
  await fs.writeFile(
    path.join(evalsDir, 'suites', 'smoke.json'),
    JSON.stringify({
      name: 'Smoke',
      taskIds: [
        'message-task',
        'workstream-task',
        'greenfield-task',
        'repo-patch-task',
      ],
    }),
  );

  const manifests = [
    {
      id: 'message-task',
      title: 'Message',
      kind: 'message',
      grade: { type: 'message-contains', pattern: 'hello' },
    },
    {
      id: 'workstream-task',
      title: 'Workstream',
      kind: 'workstream',
      grade: { type: 'workstream-status', expect: ['done'] },
    },
    {
      id: 'greenfield-task',
      title: 'Greenfield',
      kind: 'greenfield',
      grade: { type: 'shell', command: 'true' },
    },
    {
      id: 'repo-patch-task',
      title: 'Repo patch',
      kind: 'repo-patch',
      repo: { url: 'fixture', baseCommit: 'local' },
      grade: { type: 'shell', command: 'true' },
    },
  ];
  for (const manifest of manifests) {
    const taskDir = path.join(evalsDir, 'tasks', manifest.id);
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(
      path.join(taskDir, 'eval.json'),
      JSON.stringify(manifest),
    );
    await fs.writeFile(path.join(taskDir, 'prompt.md'), `${manifest.title}\n`);
  }

  let starts = 0;
  let stops = 0;
  const dispatched: string[] = [];
  const runtime = {
    client: {},
    identityDir,
    execDir,
    stop: async () => {
      stops += 1;
    },
  } as unknown as EvalRuntimeHandle;

  try {
    const output = await runIdentityEval(
      { identityDir, execDir, resultsDir },
      {
        startEvalRuntime: async () => {
          starts += 1;
          return runtime;
        },
        runMessageTask: async (_client, task) => {
          dispatched.push(task.manifest.kind);
          return result(task.manifest.id, true);
        },
        runWorkstreamTask: async (_client, task) => {
          const attempts = JSON.parse(
            await fs.readFile(path.join(resultsDir, 'attempts.json'), 'utf8'),
          ) as unknown[];
          assert.equal(attempts.length, 1);
          dispatched.push(task.manifest.kind);
          return result(task.manifest.id, false);
        },
        runGreenfieldTask: async (_client, task) => {
          dispatched.push(task.manifest.kind);
          return result(task.manifest.id, true);
        },
        runRepoPatchTask: async (_client, task) => {
          dispatched.push(task.manifest.kind);
          return result(task.manifest.id, true);
        },
        getIdentityGitSha: async () => 'abc123',
      },
    );

    assert.equal(output.resultsDir, resultsDir);
    assert.equal(starts, 1);
    assert.equal(stops, 1);
    assert.deepEqual(dispatched, [
      'message',
      'workstream',
      'greenfield',
      'repo-patch',
    ]);

    const attempts = JSON.parse(
      await fs.readFile(path.join(resultsDir, 'attempts.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    assert.deepEqual(
      attempts.map((attempt) => attempt.instanceId),
      ['message-task', 'workstream-task', 'greenfield-task', 'repo-patch-task'],
    );
    assert.equal(attempts[0]?.repo, 'identity');
    assert.equal(attempts[0]?.baseCommit, 'abc123');

    const evalReport = JSON.parse(
      await fs.readFile(path.join(resultsDir, 'eval-report.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(evalReport.resolved_ids, [
      'message-task',
      'greenfield-task',
      'repo-patch-task',
    ]);
    assert.deepEqual(evalReport.unresolved_ids, ['workstream-task']);
    assert.deepEqual(evalReport.completed_ids, [
      'message-task',
      'workstream-task',
      'greenfield-task',
      'repo-patch-task',
    ]);

    const runConfig = JSON.parse(
      await fs.readFile(path.join(resultsDir, 'run-config.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(runConfig.identityGitSha, 'abc123');
    assert.equal(runConfig.suiteId, 'smoke');

    await fs.access(path.join(resultsDir, 'report.json'));
    const latest = await fs.readlink(path.join(execDir, 'evals', 'latest'));
    assert.equal(latest, resultsDir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runIdentityEval does not start the runtime when a task cannot be loaded', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-suite-'));
  const identityDir = path.join(root, 'identity');
  const execDir = path.join(root, 'exec');
  const evalsDir = path.join(identityDir, 'agent', 'evals');
  await fs.mkdir(path.join(evalsDir, 'suites'), { recursive: true });
  await fs.writeFile(
    path.join(evalsDir, 'suites', 'smoke.json'),
    JSON.stringify({ name: 'Smoke', taskIds: ['missing-task'] }),
  );

  let started = false;
  try {
    await assert.rejects(
      runIdentityEval(
        { identityDir, execDir },
        {
          startEvalRuntime: async () => {
            started = true;
            return {
              client: {},
              identityDir,
              execDir,
              stop: async () => {},
            } as unknown as EvalRuntimeHandle;
          },
          getIdentityGitSha: async () => 'abc123',
        },
      ),
      /ENOENT/,
    );
    assert.equal(started, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runIdentityEval refuses llm-judge without opt-in', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-judge-'));
  const identityDir = path.join(root, 'identity');
  const execDir = path.join(root, 'exec');
  const evalsDir = path.join(identityDir, 'agent', 'evals');
  await fs.mkdir(path.join(evalsDir, 'suites'), { recursive: true });
  await fs.mkdir(path.join(evalsDir, 'tasks', 'tone'), { recursive: true });
  await fs.writeFile(
    path.join(evalsDir, 'suites', 'smoke.json'),
    JSON.stringify({ name: 'Smoke', taskIds: ['tone'] }),
  );
  await fs.writeFile(
    path.join(evalsDir, 'tasks', 'tone', 'eval.json'),
    JSON.stringify({
      id: 'tone',
      title: 'Tone',
      kind: 'message',
      grade: { type: 'llm-judge', rubric: 'Be polite.' },
    }),
  );
  await fs.writeFile(path.join(evalsDir, 'tasks', 'tone', 'prompt.md'), 'Hi\n');

  try {
    await assert.rejects(
      runIdentityEval(
        { identityDir, execDir },
        { getIdentityGitSha: async () => 'abc123' },
      ),
      /llm-judge grader requires/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('runIdentityEval runs a pack and writes predictions.jsonl', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-pack-'));
  const identityDir = path.join(root, 'identity');
  const execDir = path.join(root, 'exec');
  const resultsDir = path.join(root, 'results');
  await fs.mkdir(identityDir, { recursive: true });

  const runtime = {
    client: {},
    identityDir,
    execDir,
    stop: async () => {},
  } as unknown as EvalRuntimeHandle;

  try {
    await runIdentityEval(
      {
        identityDir,
        execDir,
        resultsDir,
        packId: 'swebench-lite-30',
        limit: 1,
      },
      {
        startEvalRuntime: async () => runtime,
        loadEvalPack: async () => ({
          pack: {
            id: 'swebench-lite-30',
            name: 'SWE-bench Lite curated (30 tasks)',
            description: 'test',
            kind: 'swebench',
            dataset: 'princeton-nlp/SWE-bench_Lite',
            split: 'test',
            config: 'default',
            instanceIds: ['pallets__flask-4045'],
          },
          suite: {
            name: 'SWE-bench Lite curated (30 tasks)',
            taskIds: ['pallets__flask-4045'],
          },
          tasks: [
            {
              manifest: {
                id: 'pallets__flask-4045',
                title: 'flask',
                kind: 'repo-patch',
                repo: {
                  url: 'https://github.com/pallets/flask.git',
                  baseCommit: 'abc',
                },
                grade: { type: 'swebench' },
              },
              prompt: 'Fix flask',
              taskDir: '',
            },
          ],
        }),
        runRepoPatchTask: async (_client, task) => ({
          instanceId: task.manifest.id,
          outcome: 'submitted',
          durationMs: 5,
          outboundMessages: [],
          patch: 'diff --git a/x b/x\n',
        }),
        runSweBenchHarness: async () => ({
          resolved_ids: ['pallets__flask-4045'],
        }),
        getIdentityGitSha: async () => 'abc123',
      },
    );

    const predictions = await fs.readFile(
      path.join(resultsDir, 'predictions.jsonl'),
      'utf8',
    );
    assert.match(predictions, /pallets__flask-4045/);
    const report = JSON.parse(
      await fs.readFile(path.join(resultsDir, 'eval-report.json'), 'utf8'),
    ) as { resolved_ids: string[] };
    assert.deepEqual(report.resolved_ids, ['pallets__flask-4045']);
    const runConfig = JSON.parse(
      await fs.readFile(path.join(resultsDir, 'run-config.json'), 'utf8'),
    ) as { packId: string; suiteId: string };
    assert.equal(runConfig.packId, 'swebench-lite-30');
    assert.equal(runConfig.suiteId, 'swebench-lite-30');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
