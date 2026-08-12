import assert from 'node:assert/strict';
import childProcess, { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

test('startEvalRuntime spawns an identity-aware runtime in eval mode', async () => {
  const runtime = await import('./runtime.js');
  assert.equal(typeof runtime.startEvalRuntime, 'function');

  const originalSpawn = childProcess.spawn;
  const originalFetch = globalThis.fetch;
  let spawnedEnv: NodeJS.ProcessEnv | undefined;

  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 1234,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      queueMicrotask(() => child.emit('exit', 0));
      return true;
    },
  });

  childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
    spawnedEnv = args[2]?.env;
    return child;
  }) as typeof childProcess.spawn;
  globalThis.fetch = (async () =>
    new Response(null, { status: 200 })) as typeof fetch;

  try {
    const handle = await runtime.startEvalRuntime({
      identityDir: '/tmp/artificer-test-identity',
      execDir: '/tmp/artificer-test-exec',
      presetId: 'quality-first',
      models: { medium: 'test-medium-model' },
    });

    assert.equal(handle.identityDir, '/tmp/artificer-test-identity');
    assert.equal(handle.execDir, '/tmp/artificer-test-exec');
    assert.deepEqual(
      {
        ARTIFICER_IDENTITY_DIR: spawnedEnv?.ARTIFICER_IDENTITY_DIR,
        ARTIFICER_EXEC_DIR: spawnedEnv?.ARTIFICER_EXEC_DIR,
        RUNTIME_EVAL_MODE: spawnedEnv?.RUNTIME_EVAL_MODE,
        RUNTIME_CONCURRENCY: spawnedEnv?.RUNTIME_CONCURRENCY,
        RUNTIME_RESUME_ON_STARTUP: spawnedEnv?.RUNTIME_RESUME_ON_STARTUP,
        MODEL_PRESET: spawnedEnv?.MODEL_PRESET,
        LLM_MODEL: spawnedEnv?.LLM_MODEL,
      },
      {
        ARTIFICER_IDENTITY_DIR: '/tmp/artificer-test-identity',
        ARTIFICER_EXEC_DIR: '/tmp/artificer-test-exec',
        RUNTIME_EVAL_MODE: 'true',
        RUNTIME_CONCURRENCY: '1',
        RUNTIME_RESUME_ON_STARTUP: 'false',
        MODEL_PRESET: 'quality-first',
        LLM_MODEL: 'test-medium-model',
      },
    );

    await handle.stop();
  } finally {
    childProcess.spawn = originalSpawn;
    globalThis.fetch = originalFetch;
  }
});

test('the eval package exports startEvalRuntime', async () => {
  const runtime = await import('./runtime.js');
  const evalPackage = await import('../index.js');
  assert.equal(evalPackage.startEvalRuntime, runtime.startEvalRuntime);
});
