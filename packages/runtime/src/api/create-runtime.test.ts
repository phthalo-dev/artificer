import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './create-runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('createRuntime', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-runtime-'));
    fs.mkdirSync(path.join(tmpDir, 'identity', 'memories'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'exec'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a runtime from a directory', async () => {
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir: path.join(tmpDir, 'exec'),
      },
    });

    assert.ok(runtime.engine);
    assert.ok(runtime.app);
    assert.ok(runtime.config);
    assert.ok(runtime.identity);
    assert.ok(runtime.tools);
    assert.equal(typeof runtime.start, 'function');
  });

  it('uses explicit execDir when provided', async () => {
    const execDir = path.join(tmpDir, 'exec');
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir,
      },
    });

    assert.equal(runtime.config.execDir, execDir);
  });

  it('uses identity/ for identity store', async () => {
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir: path.join(tmpDir, 'exec'),
      },
    });

    assert.equal(runtime.config.identityDir, tmpDir);
  });

  it('resolves an SDK identity pullInterval to milliseconds', async () => {
    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir: path.join(tmpDir, 'exec'),
        identity: { pullInterval: '5m' },
      },
    });

    assert.equal(runtime.config.identity?.pullIntervalMs, 300_000);
  });

  it('loads agentName and preset from artificer.config.json', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'artificer.config.json'),
      JSON.stringify({ name: 'TestBot', preset: 'ultra-budget' }),
    );

    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir: path.join(tmpDir, 'exec'),
      },
    });

    assert.equal(runtime.config.agentName, 'TestBot');
    assert.equal(runtime.config.modelPresetId, 'ultra-budget');
  });

  it('discovers skills from agent/skills/', async () => {
    fs.mkdirSync(path.join(tmpDir, 'agent', 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'agent', 'skills', 'review.md'),
      '# Review\nCheck things.',
    );

    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir: path.join(tmpDir, 'exec'),
      },
    });

    assert.equal(runtime.skills.length, 1);
    assert.equal(runtime.skills[0].name, 'review');
  });

  it('loads and mounts channels from agent/channels/', async () => {
    const channelsDir = path.join(tmpDir, 'agent', 'channels');
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.symlinkSync(
      path.join(__dirname, '../discover/fixtures/echo-channel.ts'),
      path.join(channelsDir, 'echo.ts'),
    );

    const runtime = await createRuntime({
      rootDir: tmpDir,
      config: {
        apiKey: 'test-key',
        baseURL: 'http://localhost:9999',
        execDir: path.join(tmpDir, 'exec'),
      },
    });

    const res = await runtime.app.request('/channels/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello channel' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { text: 'hello channel' });
  });
});
