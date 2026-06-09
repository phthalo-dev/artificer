import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveAgentConfigAsync, type AgentConfig } from './agent-config.js';
import { ARCHETYPES } from './archetypes.js';
import { BUNDLED_SKILLS_DIR } from './bundled-skills.js';
import { composeSystemPrompt, loadSkills, type SkillsConfig } from './skills.js';

async function makeSkillsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-skills-'));
  await fs.writeFile(path.join(dir, 'react.md'), 'Use React hooks, not classes.\n');
  await fs.mkdir(path.join(dir, 'design', 'SKILL.md'.length === 0 ? '' : '.'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(dir, 'design', 'SKILL.md'),
    'Always provide accessible color contrast.\n',
  );
  await fs.writeFile(path.join(dir, 'plain.md'), 'Just some notes.\n');
  return dir;
}

function cfg(dir: string, overrides: Partial<SkillsConfig> = {}): SkillsConfig {
  return { enabled: true, dir, maxTotalChars: 24_000, ...overrides };
}

test('loadSkills returns nothing when no search dirs are configured', async () => {
  const out = await loadSkills(['react'], { enabled: false, dir: '' });
  assert.equal(out.content, '');
  assert.deepEqual(out.loaded, []);
  assert.deepEqual(out.missing, ['react']);
  assert.equal(out.truncated, false);
});

test('loadSkills returns nothing for an empty name list', async () => {
  const dir = await makeSkillsDir();
  const out = await loadSkills([], cfg(dir));
  assert.equal(out.content, '');
  assert.deepEqual(out.loaded, []);
  assert.deepEqual(out.missing, []);
});

test('loadSkills reads flat .md files', async () => {
  const dir = await makeSkillsDir();
  const out = await loadSkills(['react'], cfg(dir));
  assert.equal(out.missing.length, 0);
  assert.deepEqual(out.loaded, ['react']);
  assert.match(out.content, /## Skill: react/);
  assert.match(out.content, /Use React hooks, not classes\./);
});

test('loadSkills reads <name>/SKILL.md', async () => {
  const dir = await makeSkillsDir();
  const out = await loadSkills(['design'], cfg(dir));
  assert.deepEqual(out.loaded, ['design']);
  assert.match(out.content, /## Skill: design/);
  assert.match(out.content, /Always provide accessible color contrast\./);
});

test('loadSkills reports missing names but does not throw', async () => {
  const dir = await makeSkillsDir();
  const out = await loadSkills(['nope', 'react'], cfg(dir));
  assert.deepEqual(out.loaded, ['react']);
  assert.deepEqual(out.missing, ['nope']);
});

test('loadSkills concatenates multiple skills in the requested order', async () => {
  const dir = await makeSkillsDir();
  const out = await loadSkills(['design', 'react', 'plain'], cfg(dir));
  assert.equal(out.content.indexOf('## Skill: design') < out.content.indexOf('## Skill: react'), true);
  assert.equal(out.content.indexOf('## Skill: react') < out.content.indexOf('## Skill: plain'), true);
  assert.deepEqual(out.missing, []);
});

test('loadSkills truncates with marker when over maxTotalChars', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artificer-skills-trunc-'));
  await fs.writeFile(path.join(dir, 'a.md'), 'x'.repeat(100));
  await fs.writeFile(path.join(dir, 'b.md'), 'y'.repeat(100));
  const out = await loadSkills(['a', 'b'], cfg(dir, { maxTotalChars: 120 }));
  assert.equal(out.truncated, true);
  assert.match(out.content, /…truncated/);
  assert.ok(out.content.length < 300, 'content should be cut down');
});

test('loadSkills silently ignores a missing skills dir', async () => {
  const dir = path.join(os.tmpdir(), 'artificer-skills-missing-' + Date.now());
  const out = await loadSkills(['react'], cfg(dir));
  assert.equal(out.content, '');
  assert.deepEqual(out.missing, ['react']);
});

test('composeSystemPrompt appends skills before extension', () => {
  const base = 'BASE';
  const out = composeSystemPrompt(base, 'EXT', {
    content: '## Skill: x\nbody',
    loaded: ['x'],
    missing: [],
    truncated: false,
  });
  const baseIdx = out.indexOf('BASE');
  const skillsIdx = out.indexOf('# Composed skills');
  const extIdx = out.indexOf('EXT');
  assert.equal(baseIdx, 0);
  assert.ok(skillsIdx > baseIdx);
  assert.ok(extIdx > skillsIdx);
});

test('composeSystemPrompt without skills keeps the original ordering', () => {
  const out = composeSystemPrompt('BASE', 'EXT', {
    content: '',
    loaded: [],
    missing: [],
    truncated: false,
  });
  assert.equal(out, 'BASE\n\nEXT');
});

test('resolveAgentConfigAsync loads bundled and external skills', async () => {
  const dir = await makeSkillsDir();
  const config: AgentConfig = {
    id: 'a1',
    name: 'coder-with-skills',
    archetype: 'coder',
    modelTier: 'medium',
    skills: ['react', 'design', 'nope'],
  };
  const resolved = await resolveAgentConfigAsync(config, 'Artie', cfg(dir));
  assert.ok(resolved.loadedSkills.includes('react'));
  assert.ok(resolved.loadedSkills.includes('design'));
  assert.ok(resolved.loadedSkills.includes('test-driven-development'));
  assert.deepEqual(resolved.missingSkills, ['nope']);
  assert.match(resolved.systemPrompt, /## Skill: react/);
  assert.match(resolved.systemPrompt, /## Skill: design/);
  assert.match(resolved.systemPrompt, /## Skill: test-driven-development/);
  assert.ok(!/## Skill: nope/.test(resolved.systemPrompt));
});

test('resolveAgentConfigAsync still loads bundled skills when external dir disabled', async () => {
  const dir = await makeSkillsDir();
  const config: AgentConfig = {
    id: 'a1',
    name: 'x',
    archetype: 'coder',
    modelTier: 'medium',
    skills: ['react'],
  };
  const resolved = await resolveAgentConfigAsync(
    config,
    'Artie',
    cfg(dir, { enabled: false }),
  );
  assert.equal(resolved.systemPrompt.includes('## Skill: react'), false);
  assert.ok(resolved.systemPrompt.includes('## Skill: test-driven-development'));
  assert.ok(resolved.loadedSkills.includes('test-driven-development'));
  assert.deepEqual(resolved.missingSkills, ['react']);
});

test('bundled superpowers skills load for every archetype defaultSkills entry', async () => {
  const cfg: SkillsConfig = {
    enabled: false,
    dir: '',
    maxTotalChars: 100_000,
    additionalDirs: [BUNDLED_SKILLS_DIR],
  };
  for (const name of Object.keys(ARCHETYPES) as Array<keyof typeof ARCHETYPES>) {
    const archetype = ARCHETYPES[name];
    if (archetype.defaultSkills.length === 0) continue;
    const out = await loadSkills(archetype.defaultSkills, cfg);
    assert.deepEqual(
      out.missing,
      [],
      `${name} missing bundled skills: ${out.missing.join(', ')}`,
    );
    assert.equal(out.loaded.length, archetype.defaultSkills.length, name);
  }
});

test('resolveAgentConfigAsync still applies promptExtension after skills', async () => {
  const dir = await makeSkillsDir();
  const config: AgentConfig = {
    id: 'a1',
    name: 'x',
    archetype: 'coder',
    modelTier: 'medium',
    skills: ['react'],
    promptExtension: 'ALWAYS do X.',
  };
  const resolved = await resolveAgentConfigAsync(config, 'Artie', cfg(dir));
  assert.ok(resolved.systemPrompt.endsWith('ALWAYS do X.'));
  assert.ok(resolved.systemPrompt.includes('## Skill: react'));
});
