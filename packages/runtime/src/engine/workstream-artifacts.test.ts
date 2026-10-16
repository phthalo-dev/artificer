import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store } from '../storage/store.js';
import {
  validateArtifactKey,
  WorkstreamArtifactService,
} from './workstream-artifacts.js';

async function buildService() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'artificer-artifacts-'),
  );
  const store = new Store(dataDir);
  await store.init();
  const traceEvents: unknown[] = [];
  const service = new WorkstreamArtifactService(store, async (mutation) => {
    traceEvents.push(mutation);
  });
  const workstream = await store.createWorkstream({
    title: 'Artifact test',
    goal: 'Exercise versioned artifacts',
  });
  return { service, store, workstream, traceEvents, dataDir };
}

async function artifactFixture() {
  const fixture = await buildService();
  return { ...fixture, wsId: fixture.workstream.id };
}

test('publish releases a non-markdown type and a second publish becomes current', async () => {
  const { service, store, wsId } = await artifactFixture();
  const first = await service.publish(wsId, {
    key: 'note',
    name: 'Note',
    content: '{"a":1}',
    contentType: 'application/json',
  });
  assert.equal(first.currentVersion, 'v1');
  assert.equal(first.versions[0].state, 'released');
  assert.equal(first.versions[0].contentType, 'application/json');
  assert.equal(first.approvalStatus, 'not_requested');
  assert.equal(
    await fs.readFile(
      store.layout.artifactVersionContentFile(wsId, 'note', 'v1'),
      'utf8',
    ),
    '{"a":1}',
  );
  const second = await service.publish(wsId, {
    key: 'note',
    name: 'Note',
    content: '{"a":2}',
    contentType: 'application/json',
  });
  assert.equal(second.currentVersion, 'v2');
});

test('creates artifact metadata without content', async () => {
  const { service, workstream } = await buildService();
  const artifact = await service.create(workstream.id, {
    key: 'plan',
    name: 'Plan',
    contentType: 'text/markdown',
  });
  assert.equal(artifact.key, 'plan');
  assert.equal(artifact.visibility, 'private');
  assert.deepEqual(artifact.versions, []);
});

test('rejects invalid artifact keys and path escape attempts', async () => {
  const { service, workstream } = await buildService();
  assert.throws(() => validateArtifactKey('../evil'), /Invalid artifact key/);
  await assert.rejects(
    service.create(workstream.id, {
      key: '../evil',
      name: 'Bad',
      contentType: 'text/plain',
    }),
    /Invalid artifact key/,
  );
});

test('stores immutable version bytes with hash and size', async () => {
  const { service, workstream, store } = await buildService();
  await service.create(workstream.id, {
    key: 'report',
    name: 'Report',
    contentType: 'text/markdown',
  });
  const { version } = await service.createVersion(workstream.id, 'report', {
    content: '# Report\n\nDone.',
  });
  assert.equal(version.version, 'v1');
  assert.equal(version.byteSize, 15);
  assert.match(version.sha256, /^[a-f0-9]{64}$/);
  assert.equal(version.state, 'ready');

  const contentPath = store.layout.artifactVersionContentFile(
    workstream.id,
    'report',
    'v1',
  );
  const onDisk = await fs.readFile(contentPath, 'utf8');
  assert.equal(onDisk, '# Report\n\nDone.');
});

test('idempotent re-upload with the same key returns the existing version', async () => {
  const { service, workstream } = await buildService();
  await service.create(workstream.id, {
    key: 'diff',
    name: 'Diff',
    contentType: 'text/plain',
  });
  const first = await service.createVersion(workstream.id, 'diff', {
    content: 'same bytes',
    idempotencyKey: 'upload-1',
  });
  const second = await service.createVersion(workstream.id, 'diff', {
    content: 'same bytes',
    idempotencyKey: 'upload-1',
  });
  assert.equal(first.version.version, second.version.version);
  const artifact = await service.get(workstream.id, 'diff');
  assert.equal(artifact?.versions.length, 1);
});

test('rejects idempotent re-upload with different content', async () => {
  const { service, workstream } = await buildService();
  await service.create(workstream.id, {
    key: 'benchmark',
    name: 'Benchmark',
    contentType: 'application/json',
  });
  await service.createVersion(workstream.id, 'benchmark', {
    content: '{"score": 1}',
    idempotencyKey: 'bench-1',
  });
  await assert.rejects(
    service.createVersion(workstream.id, 'benchmark', {
      content: '{"score": 2}',
      idempotencyKey: 'bench-1',
    }),
    /different content/,
  );
});

test('release updates current version without mutating content bytes', async () => {
  const { service, workstream, store } = await buildService();
  await service.create(workstream.id, {
    key: 'receipt',
    name: 'Receipt',
    contentType: 'text/markdown',
  });
  const { version } = await service.createVersion(workstream.id, 'receipt', {
    content: 'Receipt body',
  });
  const released = await service.releaseVersion(
    workstream.id,
    'receipt',
    version.version,
  );
  assert.equal(released.currentVersion, 'v1');
  const before = await fs.readFile(
    store.layout.artifactVersionContentFile(workstream.id, 'receipt', 'v1'),
    'utf8',
  );
  assert.equal(before, 'Receipt body');
});

test('blocks release of unapproved versions after approval was requested', async () => {
  const { service, workstream } = await buildService();
  await service.create(workstream.id, {
    key: 'review',
    name: 'Review',
    contentType: 'text/markdown',
  });
  const { version } = await service.createVersion(workstream.id, 'review', {
    content: 'Needs review',
  });
  await service.requestApproval(workstream.id, 'review', version.version);
  await assert.rejects(
    service.releaseVersion(workstream.id, 'review', version.version),
    /must be approved/,
  );
  await service.approveVersion(workstream.id, 'review', version.version);
  const released = await service.releaseVersion(
    workstream.id,
    'review',
    version.version,
  );
  assert.equal(released.currentVersion, 'v1');
});

test('archive and restore preserve all versions', async () => {
  const { service, workstream } = await buildService();
  await service.create(workstream.id, {
    key: 'plan',
    name: 'Plan',
    contentType: 'text/markdown',
  });
  await service.createVersion(workstream.id, 'plan', { content: 'v1' });
  await service.createVersion(workstream.id, 'plan', { content: 'v2' });
  const archived = await service.archive(workstream.id, 'plan');
  assert.ok(archived.archivedAt);
  assert.equal(archived.versions.length, 2);
  const restored = await service.restore(workstream.id, 'plan');
  assert.equal(restored.archivedAt, undefined);
  assert.equal(restored.versions.length, 2);
});

test('bounded content reads do not load the entire artifact', async () => {
  const { service, workstream } = await buildService();
  await service.create(workstream.id, {
    key: 'report',
    name: 'Report',
    contentType: 'text/plain',
  });
  await service.createVersion(workstream.id, 'report', {
    content: 'abcdefghijklmnop',
  });
  const { content, truncated } = await service.readVersionContent(
    workstream.id,
    'report',
    'v1',
    5,
  );
  assert.equal(content.toString('utf8'), 'abcde');
  assert.equal(truncated, true);
});

test('artifact operations emit durable trace events', async () => {
  const { service, workstream, traceEvents } = await buildService();
  await service.create(workstream.id, {
    key: 'plan',
    name: 'Plan',
    contentType: 'text/markdown',
  });
  await service.createVersion(workstream.id, 'plan', { content: 'plan body' });
  assert.ok(
    traceEvents.some(
      (event) =>
        (event as { kind?: string }).kind === 'artifact' &&
        (event as { data?: { event?: string } }).data?.event === 'created',
    ),
  );
  assert.ok(
    traceEvents.some(
      (event) =>
        (event as { data?: { event?: string } }).data?.event ===
        'version_created',
    ),
  );
});
