import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineConfig } from './define-config.js';

describe('defineConfig', () => {
  it('returns the config object unchanged (identity function for type safety)', () => {
    const config = defineConfig({
      name: 'Atlas',
      description: 'Payments team agent',
    });

    assert.equal(config.name, 'Atlas');
    assert.equal(config.description, 'Payments team agent');
  });

  it('accepts full configuration', () => {
    const config = defineConfig({
      name: 'Atlas',
      preset: 'quality-first',
      models: {
        low: 'claude-haiku-4-5-20251001',
        medium: 'claude-sonnet-4-6',
        high: 'claude-opus-4-8',
      },
      roleTiers: {
        communicator: 'low',
        planner: 'high',
      },
      github: {
        watchInterval: '5m',
      },
      concurrency: 3,
      identity: {
        autoCommit: true,
        autoPush: false,
        commitPrefix: '[atlas]',
      },
    });

    assert.equal(config.preset, 'quality-first');
    assert.equal(config.models?.high, 'claude-opus-4-8');
    assert.equal(config.roleTiers?.communicator, 'low');
    assert.equal(config.concurrency, 3);
    assert.equal(config.identity?.autoCommit, true);
    assert.equal(config.github?.watchInterval, '5m');
  });

  it('works with minimal config (only name)', () => {
    const config = defineConfig({ name: 'Bot' });
    assert.equal(config.name, 'Bot');
    assert.equal(config.preset, undefined);
  });
});
