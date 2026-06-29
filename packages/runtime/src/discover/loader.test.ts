import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSkillsFromDisk, loadInstructionsFromDisk, loadRolesFromDisk, loadChannelsFromDisk } from './loader.js';

describe('loadSkillsFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-loader-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads markdown files as skills', () => {
    const skillPath = path.join(tmpDir, 'review.md');
    fs.writeFileSync(skillPath, '# Code Review\n\nCheck for bugs.');

    const skills = loadSkillsFromDisk([
      { name: 'review', path: skillPath },
    ]);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'review');
    assert.equal(skills[0].description, 'Code Review');
    assert.ok(skills[0].content.includes('Check for bugs'));
  });
});

describe('loadInstructionsFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-loader-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a markdown file as instructions', () => {
    const mdPath = path.join(tmpDir, 'instructions.md');
    fs.writeFileSync(mdPath, '## Team Rules\nBe concise.');

    const instructions = loadInstructionsFromDisk(mdPath);
    assert.ok(instructions);
    assert.ok(instructions.content.includes('Be concise'));
  });

  it('returns null for missing file', () => {
    const instructions = loadInstructionsFromDisk(
      path.join(tmpDir, 'nope.md'),
    );
    assert.equal(instructions, null);
  });
});

describe('loadRolesFromDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-roles-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses name, blurb, and baseRole from frontmatter', () => {
    const p = path.join(tmpDir, 'auditor.md');
    fs.writeFileSync(p, '---\nname: Security Auditor\nblurb: Finds bugs.\nbaseRole: reviewer\n---\n\nYou are {{agentName}}.');
    const roles = loadRolesFromDisk([{ name: 'auditor', path: p }]);
    assert.equal(roles.length, 1);
    assert.equal(roles[0].slug, 'auditor');
    assert.equal(roles[0].name, 'Security Auditor');
    assert.equal(roles[0].blurb, 'Finds bugs.');
    assert.equal(roles[0].baseRole, 'reviewer');
    assert.equal(roles[0].systemTemplate, 'You are {{agentName}}.');
  });

  it('preserves {{agentName}} in systemTemplate without substituting it', () => {
    const p = path.join(tmpDir, 'helper.md');
    fs.writeFileSync(p, '---\nname: Helper\n---\n\nYou are {{agentName}}\'s helper.');
    const roles = loadRolesFromDisk([{ name: 'helper', path: p }]);
    assert.ok(roles[0].systemTemplate.includes('{{agentName}}'));
    assert.ok(!roles[0].systemTemplate.includes('undefined'));
  });

  it('uses defaults when frontmatter fields are absent', () => {
    const p = path.join(tmpDir, 'my-role.md');
    fs.writeFileSync(p, '---\n---\n\nDo stuff.');
    const roles = loadRolesFromDisk([{ name: 'my-role', path: p }]);
    assert.equal(roles[0].slug, 'my-role');
    assert.equal(roles[0].name, 'my-role');
    assert.equal(roles[0].blurb, '');
    assert.equal(roles[0].baseRole, 'worker');
    assert.equal(roles[0].systemTemplate, 'Do stuff.');
  });

  it('falls back to worker for an unknown baseRole and warns', () => {
    const p = path.join(tmpDir, 'weird.md');
    fs.writeFileSync(p, '---\nbaseRole: nonexistent\n---\n\nBody.');
    // suppress warning output in test
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    const roles = loadRolesFromDisk([{ name: 'weird', path: p }]);
    console.warn = warn;
    assert.equal(roles[0].baseRole, 'worker');
    assert.ok(warnings.some((w) => w.includes('nonexistent')));
  });

  it('handles body-only files with no frontmatter delimiters', () => {
    const p = path.join(tmpDir, 'plain.md');
    fs.writeFileSync(p, 'Just a plain body with no frontmatter.');
    const roles = loadRolesFromDisk([{ name: 'plain', path: p }]);
    assert.equal(roles[0].name, 'plain');
    assert.equal(roles[0].baseRole, 'worker');
    assert.equal(roles[0].systemTemplate, 'Just a plain body with no frontmatter.');
  });

  it('skips unreadable files without throwing', () => {
    const roles = loadRolesFromDisk([{ name: 'missing', path: '/nonexistent/path.md' }]);
    assert.equal(roles.length, 0);
  });
});

describe('loadChannelsFromDisk', () => {
  it('loads channel modules from disk', async () => {
    const fixturePath = path.join(
      import.meta.dirname,
      'fixtures/echo-channel.ts',
    );

    const channels = await loadChannelsFromDisk([
      { name: 'echo', path: fixturePath },
    ]);

    assert.equal(channels.length, 1);
    assert.equal(channels[0].name, 'echo');
  });

  it('skips modules without a default ArtificerChannel export', async () => {
    const channels = await loadChannelsFromDisk([
      { name: 'missing', path: '/nonexistent/channel.ts' },
    ]);
    assert.equal(channels.length, 0);
  });
});
