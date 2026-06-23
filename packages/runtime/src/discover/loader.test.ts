import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSkillsFromDisk, loadInstructionsFromDisk } from './loader.js';

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
