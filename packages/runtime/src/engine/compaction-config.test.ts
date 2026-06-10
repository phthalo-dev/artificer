import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessCompactionTier,
  DEFAULT_COMPACTION,
} from './compaction-config.js';

test('assessCompactionTier returns none below soft threshold', () => {
  assert.equal(
    assessCompactionTier(DEFAULT_COMPACTION.softThresholdChars - 1, DEFAULT_COMPACTION),
    'none',
  );
});

test('assessCompactionTier returns soft between soft and hard', () => {
  assert.equal(
    assessCompactionTier(DEFAULT_COMPACTION.softThresholdChars + 1, DEFAULT_COMPACTION),
    'soft',
  );
});

test('assessCompactionTier returns hard at or above hard threshold', () => {
  assert.equal(
    assessCompactionTier(DEFAULT_COMPACTION.hardThresholdChars, DEFAULT_COMPACTION),
    'hard',
  );
});
