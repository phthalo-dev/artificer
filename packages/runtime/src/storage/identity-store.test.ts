import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IdentityLayout } from './identity-layout.js';
import { IdentityStore } from './identity-store.js';

describe('IdentityLayout', () => {
  it('resolves identity paths relative to agent root', () => {
    const layout = new IdentityLayout('/home/user/my-agent');

    assert.equal(layout.memoriesDir, '/home/user/my-agent/identity/memories');
    assert.equal(layout.skillsDir, '/home/user/my-agent/agent/skills');
    assert.equal(layout.toolsDir, '/home/user/my-agent/agent/tools');
    assert.equal(layout.channelsDir, '/home/user/my-agent/agent/channels');
    assert.equal(
      layout.instructionsFile,
      '/home/user/my-agent/agent/instructions.md',
    );
    assert.equal(
      layout.configFile,
      '/home/user/my-agent/artificer.config.json',
    );
  });

  it('resolves memory file paths', () => {
    const layout = new IdentityLayout('/home/user/my-agent');
    const memPath = layout.memoryFile('pref_abc123');

    assert.equal(
      memPath,
      '/home/user/my-agent/identity/memories/pref_abc123.md',
    );
  });

  it('resolves memory index path', () => {
    const layout = new IdentityLayout('/home/user/my-agent');
    assert.equal(
      layout.memoryIndexFile,
      '/home/user/my-agent/identity/index.json',
    );
  });
});

describe('IdentityStore', () => {
  let tmpDir: string;
  let store: IdentityStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-identity-'));
    store = new IdentityStore(tmpDir);
    await store.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a memory as a markdown file', async () => {
    const memory = await store.addMemory({
      content: 'Always use TDD in the payments repo',
      title: 'TDD preference',
      tags: ['preference', 'payments'],
      kind: 'preference',
      source: 'conversation',
    });

    assert.ok(memory.id);
    assert.equal(memory.title, 'TDD preference');

    const filePath = store.layout.memoryFile(memory.id);
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('Always use TDD'));
    assert.ok(content.includes('tags:'));
  });

  it('queries memories by keyword', async () => {
    await store.addMemory({
      content: 'The auth service uses JWT tokens',
      title: 'Auth architecture',
      tags: ['architecture'],
      kind: 'note',
    });
    await store.addMemory({
      content: 'Deploy to staging before prod',
      title: 'Deploy process',
      tags: ['process'],
      kind: 'note',
    });

    const results = await store.queryMemories('auth JWT');
    assert.ok(results.length >= 1);
    assert.ok(results[0].title?.includes('Auth'));
  });

  it('lists all memories', async () => {
    await store.addMemory({
      content: 'Fact one',
      title: 'One',
      tags: [],
      kind: 'note',
    });
    await store.addMemory({
      content: 'Fact two',
      title: 'Two',
      tags: [],
      kind: 'note',
    });

    const all = await store.listMemories();
    assert.equal(all.length, 2);
  });

  it('updates memory content', async () => {
    const memory = await store.addMemory({
      content: 'Original content',
      title: 'My memory',
      tags: ['a'],
      kind: 'note',
    });

    const updated = await store.updateMemory(memory.id, {
      content: 'Updated content',
    });

    assert.ok(updated);
    assert.equal(updated!.content, 'Updated content');
    assert.equal(updated!.title, 'My memory');
    assert.deepEqual(updated!.tags, ['a']);
  });

  it('updates memory title and tags', async () => {
    const memory = await store.addMemory({
      content: 'Some content',
      title: 'Old title',
      tags: ['old'],
      kind: 'note',
    });

    const updated = await store.updateMemory(memory.id, {
      title: 'New title',
      tags: ['new', 'tags'],
      summary: 'A summary',
    });

    assert.ok(updated);
    assert.equal(updated!.title, 'New title');
    assert.deepEqual(updated!.tags, ['new', 'tags']);
    assert.equal(updated!.summary, 'A summary');
    assert.equal(updated!.content, 'Some content');
  });

  it('returns null when updating a non-existent memory', async () => {
    const result = await store.updateMemory('nonexistent_id', { content: 'x' });
    assert.equal(result, null);
  });

  it('persists updated memory to disk', async () => {
    const memory = await store.addMemory({
      content: 'Before',
      title: 'Persist test',
      tags: [],
      kind: 'note',
    });

    await store.updateMemory(memory.id, { content: 'After' });

    const reread = await store.getMemory(memory.id);
    assert.ok(reread);
    assert.equal(reread!.content, 'After');
  });

  it('filters by tags before ranking and respects limit', async () => {
    await store.addMemory({
      content: 'Pref A',
      title: 'A',
      tags: ['preference', 'payments'],
      kind: 'preference',
    });
    await store.addMemory({
      content: 'Pref B',
      title: 'B',
      tags: ['preference', 'auth'],
      kind: 'preference',
    });
    await store.addMemory({
      content: 'Note C about preference wording',
      title: 'C',
      tags: ['architecture'],
      kind: 'note',
    });

    const results = await store.queryMemories('', {
      tags: ['preference'],
      limit: 10,
    });
    assert.equal(results.length, 2);
    assert.ok(results.every((m) => m.tags.includes('preference')));
  });

  it('truncates the top hit when it alone exceeds charBudget', async () => {
    await store.addMemory({
      content: 'x'.repeat(500),
      title: 'Huge',
      tags: ['big'],
      kind: 'note',
      summary: 'huge memory body',
    });
    await store.addMemory({
      content: 'small second',
      title: 'Small',
      tags: ['big'],
      kind: 'note',
      summary: 'tiny',
    });

    const results = await store.queryMemories('huge', { charBudget: 100 });
    assert.equal(results.length, 1);
    assert.ok(results[0].content.includes('… (truncated)'));
    assert.ok(results[0].content.length <= 100 + '… (truncated)'.length);
  });

  it('rebuilds a corrupt index.json on query', async () => {
    await store.addMemory({
      content: 'Recover me',
      title: 'Recoverable',
      tags: ['recovery'],
      kind: 'note',
    });
    fs.writeFileSync(store.layout.memoryIndexFile, '{not-json', 'utf-8');

    const results = await store.queryMemories('Recoverable');
    assert.ok(results.length >= 1);
    assert.equal(results[0].title, 'Recoverable');

    const indexRaw = fs.readFileSync(store.layout.memoryIndexFile, 'utf-8');
    const index = JSON.parse(indexRaw) as unknown[];
    assert.equal(index.length, 1);
  });

  it('memorySignpost reports count and top tags', async () => {
    assert.equal(await store.memorySignpost(), null);

    await store.addMemory({
      content: 'One',
      title: 'One',
      tags: ['alpha', 'shared'],
      kind: 'note',
    });
    await store.addMemory({
      content: 'Two',
      title: 'Two',
      tags: ['beta', 'shared'],
      kind: 'note',
    });

    const signpost = await store.memorySignpost();
    assert.ok(signpost);
    assert.match(signpost!, /You have 2 memories/);
    assert.match(signpost!, /shared/);
    assert.match(signpost!, /query_memories/);
  });
});
