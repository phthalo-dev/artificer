import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AgentConfig,
  type ResolvedAgentConfig,
  createAgentConfig,
  resolveAgentConfig,
} from './agent-config.js';
import { ARCHETYPES } from './archetypes.js';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return createAgentConfig({
    name: 'test-agent',
    archetype: 'coder',
    modelTier: 'medium',
    ...overrides,
  });
}

test('createAgentConfig assigns a unique id when not provided', () => {
  const a = createAgentConfig({
    name: 'x',
    archetype: 'coder',
    modelTier: 'medium',
  });
  const b = createAgentConfig({
    name: 'x',
    archetype: 'coder',
    modelTier: 'medium',
  });
  assert.ok(a.id);
  assert.ok(b.id);
  assert.notEqual(a.id, b.id);
  assert.ok(a.id.startsWith('agent_'));
});

test('createAgentConfig honors an explicit id', () => {
  const c = createAgentConfig({
    id: 'agent_fixed',
    name: 'x',
    archetype: 'coder',
    modelTier: 'medium',
  });
  assert.equal(c.id, 'agent_fixed');
});

test('resolveAgentConfig throws on unknown archetype', () => {
  assert.throws(
    () =>
      resolveAgentConfig(
        {
          id: 'x',
          name: 'x',
          archetype: 'nope' as never,
          modelTier: 'medium',
        },
        'Artie',
      ),
    /Unknown archetype/,
  );
});

test('resolveAgentConfig copies the archetype defaults and attaches the agent name', () => {
  const resolved = resolveAgentConfig(
    makeConfig({ archetype: 'coder' }),
    'Artie',
  );
  assert.deepEqual(resolved.tools, ARCHETYPES.coder.defaultTools);
  assert.ok(resolved.systemPrompt.includes('Artie'));
  assert.equal(resolved.archetype, 'coder');
  assert.equal(resolved.modelTier, 'medium');
  assert.equal(resolved.id, resolved.id); // present
  assert.equal(resolved.name, 'test-agent');
  assert.equal(resolved.maxTurns, 24);
  assert.deepEqual(resolved.skills, ARCHETYPES.coder.defaultSkills);
});

test('toolOverrides.remove drops tools from the archetype defaults', () => {
  const resolved = resolveAgentConfig(
    makeConfig({
      archetype: 'coder',
      toolOverrides: { remove: ['git_push', 'gh_pr_create'] },
    }),
    'Artie',
  );
  assert.ok(!resolved.tools.includes('git_push'));
  assert.ok(!resolved.tools.includes('gh_pr_create'));
  assert.ok(resolved.tools.includes('edit_file'));
});

test('toolOverrides.add appends tools without duplicating defaults', () => {
  const resolved = resolveAgentConfig(
    makeConfig({
      archetype: 'reviewer',
      toolOverrides: { add: ['submit_review', 'edit_file'] },
    }),
    'Artie',
  );
  // submit_review was already in reviewer defaults, so should not duplicate.
  const occurrences = resolved.tools.filter((t) => t === 'submit_review').length;
  assert.equal(occurrences, 1);
  assert.ok(resolved.tools.includes('edit_file'));
});

test('promptExtension appends to the archetype system prompt', () => {
  const base = resolveAgentConfig(makeConfig(), 'Artie');
  const extended = resolveAgentConfig(
    makeConfig({ promptExtension: 'Always do X.' }),
    'Artie',
  );
  assert.ok(extended.systemPrompt.endsWith('Always do X.'));
  assert.ok(extended.systemPrompt.length > base.systemPrompt.length);
  // Base prompt content is preserved at the front.
  assert.ok(
    extended.systemPrompt.startsWith(base.systemPrompt.slice(0, 200)),
  );
});

test('maxTurns default is 24 and is overridable', () => {
  const a = resolveAgentConfig(makeConfig(), 'Artie');
  const b = resolveAgentConfig(makeConfig({ maxTurns: 5 }), 'Artie');
  assert.equal(a.maxTurns, 24);
  assert.equal(b.maxTurns, 5);
});

test('skills merge archetype defaults with explicit skills', () => {
  const a = resolveAgentConfig(makeConfig(), 'Artie');
  assert.deepEqual(a.skills, ARCHETYPES.coder.defaultSkills);
  const b = resolveAgentConfig(makeConfig({ skills: ['react', 'design'] }), 'Artie');
  assert.deepEqual(b.skills, [
    ...ARCHETYPES.coder.defaultSkills,
    'react',
    'design',
  ]);
});

test('modelOverride and contextDirectives pass through to resolved', () => {
  const r = resolveAgentConfig(
    makeConfig({
      modelOverride: 'gpt-5.4-mini',
      contextDirectives: 'extra context here',
    }),
    'Artie',
  ) satisfies ResolvedAgentConfig;
  assert.equal(r.modelOverride, 'gpt-5.4-mini');
  assert.equal(r.contextDirectives, 'extra context here');
});
