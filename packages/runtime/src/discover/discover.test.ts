import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanAgentDirectory } from './discover.js';

describe('scanAgentDirectory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-discover-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers tools, channels, skills, instructions, and config', () => {
    fs.mkdirSync(path.join(tmpDir, 'agent', 'tools'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'agent', 'channels'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'agent', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'agent', 'tools', 'jira.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'agent', 'channels', 'slack.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'agent', 'skills', 'review.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'agent', 'instructions.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'artificer.config.ts'), '');

    const manifest = scanAgentDirectory(tmpDir);
    assert.equal(manifest.tools.length, 1);
    assert.equal(manifest.tools[0].name, 'jira');
    assert.equal(manifest.channels.length, 1);
    assert.equal(manifest.channels[0].name, 'slack');
    assert.equal(manifest.skills.length, 1);
    assert.equal(manifest.skills[0].name, 'review');
    assert.ok(manifest.instructions);
    assert.ok(manifest.config);
  });

  it('returns empty manifest for bare directory', () => {
    const manifest = scanAgentDirectory(tmpDir);
    assert.equal(manifest.tools.length, 0);
    assert.equal(manifest.channels.length, 0);
    assert.equal(manifest.skills.length, 0);
    assert.equal(manifest.instructions, undefined);
    assert.equal(manifest.config, undefined);
  });

  it('discovers identity/memories', () => {
    fs.mkdirSync(path.join(tmpDir, 'identity', 'memories'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'identity', 'memories', 'pref_abc.md'),
      '---\nid: "pref_abc"\n---\n\nContent',
    );

    const manifest = scanAgentDirectory(tmpDir);
    assert.equal(manifest.memories.length, 1);
    assert.equal(manifest.memories[0].name, 'pref_abc');
  });
});
