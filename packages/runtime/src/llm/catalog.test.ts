import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogPricing,
  inferPackage,
  MODEL_CATALOG,
  packageForModel,
} from './catalog.js';

const ZEN_OPEN_WEIGHT_IDS = [
  'kimi-k3',
  'kimi-k2.7-code',
  'laguna-s-2.1-free',
  'north-mini-code-free',
] as const;

test('Zen open-weight models are in the catalog', () => {
  for (const id of ZEN_OPEN_WEIGHT_IDS) {
    assert.ok(MODEL_CATALOG[id], `missing catalog entry: ${id}`);
  }
});

test('Zen open-weight models use openai-compatible SDK package', () => {
  for (const id of ZEN_OPEN_WEIGHT_IDS) {
    assert.equal(packageForModel(id), '@ai-sdk/openai-compatible');
  }
});

test('free-tier models have zero pricing', () => {
  for (const id of ['laguna-s-2.1-free', 'north-mini-code-free'] as const) {
    const p = catalogPricing(id)!;
    assert.equal(p.inputPerMTok, 0);
    assert.equal(p.outputPerMTok, 0);
  }
});

test('kimi-k3 has published Zen pricing', () => {
  const p = catalogPricing('kimi-k3')!;
  assert.equal(p.inputPerMTok, 3);
  assert.equal(p.outputPerMTok, 15);
  assert.equal(p.cacheReadPerMTok, 0.3);
});

test('inferPackage handles baseten-style slugs', () => {
  assert.equal(
    inferPackage('moonshotai/Kimi-K3'),
    '@ai-sdk/openai-compatible',
  );
  assert.equal(
    inferPackage('thinkingmachines/inkling'),
    '@ai-sdk/openai-compatible',
  );
});
