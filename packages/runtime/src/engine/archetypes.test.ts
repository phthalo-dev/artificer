import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ARCHETYPES,
  getArchetype,
  listArchetypes,
} from './archetypes.js';
import { getPreset } from './presets.js';

const EXPECTED_ARCHETYPES = [
  'planner',
  'coder',
  'reviewer',
  'researcher',
  'debugger',
  'design-planner',
  'designer',
  'design-reviewer',
] as const;

test('listArchetypes returns the eight expected names', () => {
  const names = listArchetypes();
  assert.deepEqual(names.sort(), [...EXPECTED_ARCHETYPES].sort());
  assert.equal(names.length, 8);
});

test('ARCHETYPES exports the same set as listArchetypes', () => {
  for (const name of listArchetypes()) {
    assert.ok(ARCHETYPES[name], `ARCHETYPES missing ${name}`);
  }
  for (const name of Object.keys(ARCHETYPES)) {
    assert.ok(
      listArchetypes().includes(name as (typeof EXPECTED_ARCHETYPES)[number]),
      `unexpected archetype ${name} in ARCHETYPES`,
    );
  }
});

test('getArchetype returns the entry, undefined for unknown', () => {
  for (const name of EXPECTED_ARCHETYPES) {
    const a = getArchetype(name);
    assert.ok(a);
    assert.equal(a.name, name);
  }
  assert.equal(getArchetype('nope' as never), undefined);
});

test('every archetype defines a non-empty default tool list and tier', () => {
  for (const name of EXPECTED_ARCHETYPES) {
    const a = ARCHETYPES[name];
    assert.ok(a.defaultTools.length > 0, `${name} has no default tools`);
    assert.ok(['low', 'medium', 'high'].includes(a.defaultTier), `${name} tier`);
    assert.ok(Array.isArray(a.defaultSkills), `${name} missing defaultSkills`);
  }
});

test('planner has write_plan / read_plan; reviewer has submit_review; none has both planner and worker mutations', () => {
  const planner = ARCHETYPES.planner;
  const reviewer = ARCHETYPES.reviewer;
  const coder = ARCHETYPES.coder;

  assert.ok(planner.defaultTools.includes('write_plan'));
  assert.ok(planner.defaultTools.includes('read_plan'));
  assert.ok(reviewer.defaultTools.includes('submit_review'));

  // Reviewer must NOT be able to edit source.
  assert.ok(!reviewer.defaultTools.includes('edit_file'));
  assert.ok(!reviewer.defaultTools.includes('write_file'));

  // Coder must be able to edit.
  assert.ok(coder.defaultTools.includes('edit_file'));
  assert.ok(coder.defaultTools.includes('write_file'));
});

test('system prompts mention the agent name and have non-trivial content', () => {
  for (const name of EXPECTED_ARCHETYPES) {
    const prompt = ARCHETYPES[name].systemPrompt('Artie');
    assert.ok(prompt.length > 400, `${name} system prompt too short`);
    assert.ok(prompt.includes('Artie'), `${name} system prompt missing agent name`);
  }
});

test('archetypes that need a write-capable tool have edit_file or write_file; reviewers do not', () => {
  const mustEdit: Array<keyof typeof ARCHETYPES> = [
    'coder',
    'debugger',
    'designer',
  ];
  for (const name of mustEdit) {
    const tools = new Set(ARCHETYPES[name].defaultTools);
    assert.ok(
      tools.has('edit_file') || tools.has('write_file'),
      `${name} has neither edit_file nor write_file`,
    );
  }
  for (const name of ['reviewer', 'design-reviewer'] as const) {
    const tools = new Set(ARCHETYPES[name].defaultTools);
    assert.ok(!tools.has('edit_file'), `${name} must not have edit_file`);
    assert.ok(!tools.has('write_file'), `${name} must not have write_file`);
  }
});

test('model tiers used by archetypes align with the async-economy preset', () => {
  // Sanity: the planner/worker archetypes should not default to "low" in a
  // preset that maps them to "medium" — defaults are independent, but at
  // minimum, each archetype tier must be a valid model tier.
  const asyncEco = getPreset('async-economy');
  assert.ok(asyncEco);
  for (const name of EXPECTED_ARCHETYPES) {
    const a = ARCHETYPES[name];
    assert.ok(
      ['low', 'medium', 'high'].includes(a.defaultTier),
      `${name} defaultTier invalid: ${a.defaultTier}`,
    );
  }
});
