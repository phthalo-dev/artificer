import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  compactionProfileForModel,
  parseCompactionProfileName,
} from './compaction-thresholds.js';

test('gpt-5 family uses the aggressive profile (1 prior run, microcompact on)', () => {
  for (const id of [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5.2',
    'gpt-5.4-mini',
    'gpt-5.1-codex',
    'openai/gpt-5',
    'openai/gpt-5.1-codex',
    'azure/gpt-5-chat-latest',
  ]) {
    const profile = compactionProfileForModel(id);
    assert.equal(profile.name, 'aggressive', id);
    assert.equal(profile.priorRunsToInclude, 1, id);
    assert.equal(profile.microcompactAggressive, true, id);
  }
});

test('gpt-5 family matcher rejects nearby non-gpt-5 names', () => {
  for (const id of ['gpt-4.1', 'gpt-50', 'claude-sonnet-4', 'my-gpt-5']) {
    assert.notEqual(compactionProfileForModel(id).name, 'aggressive', id);
  }
});

test('claude-sonnet family uses the default profile', () => {
  for (const id of [
    'claude-sonnet-4',
    'claude-sonnet-4-6',
    'anthropic/claude-sonnet-4-5',
  ]) {
    const profile = compactionProfileForModel(id);
    assert.equal(profile.name, 'default', id);
    assert.equal(profile.priorRunsToInclude, 8, id);
    assert.equal(profile.microcompactAggressive, false, id);
  }
});

test('long-context gemini models keep more prior runs', () => {
  for (const id of [
    'gemini-3.1-pro',
    'gemini-3.5-flash',
    'google/gemini-3-flash',
  ]) {
    const profile = compactionProfileForModel(id);
    assert.equal(profile.name, 'generous', id);
    assert.equal(profile.priorRunsToInclude, 12, id);
    assert.equal(profile.microcompactAggressive, false, id);
  }
});

test('unknown models fall back to the default profile', () => {
  const profile = compactionProfileForModel('kimi-k3');
  assert.equal(profile.name, 'default');
  assert.equal(profile.priorRunsToInclude, 8);
});

test('empty or whitespace model ids fall back to default', () => {
  assert.equal(compactionProfileForModel('').name, 'default');
  assert.equal(compactionProfileForModel('   ').name, 'default');
});

test('explicit profile override wins over model-family detection', () => {
  const gpt = compactionProfileForModel('gpt-5.4', 'default');
  assert.equal(gpt.name, 'default');
  assert.equal(gpt.priorRunsToInclude, 8);

  const claude = compactionProfileForModel('claude-sonnet-4-6', 'aggressive');
  assert.equal(claude.name, 'aggressive');
  assert.equal(claude.priorRunsToInclude, 1);

  const gemini = compactionProfileForModel('gemini-3.1-pro', 'aggressive');
  assert.equal(gemini.name, 'aggressive');
});

test('parseCompactionProfileName accepts named profiles and treats auto as unset', () => {
  assert.equal(parseCompactionProfileName('aggressive'), 'aggressive');
  assert.equal(parseCompactionProfileName('default'), 'default');
  assert.equal(parseCompactionProfileName('generous'), 'generous');
  assert.equal(parseCompactionProfileName('AGGRESSIVE'), 'aggressive');
  assert.equal(parseCompactionProfileName('auto'), undefined);
  assert.equal(parseCompactionProfileName(''), undefined);
  assert.equal(parseCompactionProfileName(undefined), undefined);
  assert.equal(parseCompactionProfileName('nope'), undefined);
});
