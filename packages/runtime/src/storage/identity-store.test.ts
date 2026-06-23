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
      '/home/user/my-agent/artificer.config.ts',
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
});
