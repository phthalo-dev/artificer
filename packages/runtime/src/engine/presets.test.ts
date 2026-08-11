import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPreset, isPresetId } from './presets.js';

test('open-weights-economy preset exists with expected tiers', () => {
  assert.ok(isPresetId('open-weights-economy'));
  const preset = getPreset('open-weights-economy')!;
  assert.equal(preset.tiers.low, 'north-mini-code-free');
  assert.equal(preset.tiers.medium, 'laguna-s-2.1-free');
  assert.equal(preset.tiers.high, 'kimi-k3');
  assert.equal(preset.roleTiers.worker, 'medium');
});

test('baseten-open-weights preset uses Baseten slugs', () => {
  const preset = getPreset('baseten-open-weights')!;
  assert.equal(preset.tiers.low, 'thinkingmachines/inkling-small');
  assert.equal(preset.tiers.medium, 'thinkingmachines/inkling');
  assert.equal(preset.tiers.high, 'moonshotai/Kimi-K3');
});
