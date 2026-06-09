import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BenchConfig } from './config.js';
import { applySuiteDefaults } from './suite-defaults.js';
import type { RoleName } from '../../src/storage/types.js';

function baseConfig(overrides: Partial<BenchConfig> = {}): BenchConfig {
  const roleTiers = {
    communicator: 'low',
    orchestrator: 'low',
    planner: 'medium',
    reviewer: 'low',
    worker: 'medium',
    librarian: 'low',
  } as Record<RoleName, 'low' | 'medium' | 'high'>;

  return {
    suitePath: 'tasks/deepswe-mini-suite.json',
    runtimePort: 4111,
    pollIntervalMs: 5000,
    instanceTimeoutMs: 1_200_000,
    maxRunsPerWorkstream: 40,
    maxIterationsPerCall: 30,
    maxIterationsPlanner: 15,
    maxCallDurationMs: 600_000,
    models: { low: 'a', medium: 'b', high: 'c' },
    roleTiers,
    modelName: 'test',
    keepData: false,
    resultsDir: '/tmp',
    liveProgress: true,
    showTools: true,
    preflightClone: false,
    noPreflightClone: false,
    preflightCloneExplicit: false,
    dockerMode: 'off',
    dockerModeExplicit: false,
    singleLoop: false,
    ...overrides,
  };
}

describe('applySuiteDefaults', () => {
  it('enables Harbor defaults for deepswe suites', () => {
    const out = applySuiteDefaults(baseConfig(), 'deepswe');
    assert.equal(out.preflightClone, true);
    assert.equal(out.dockerMode, 'auto');
    assert.equal(out.maxRunsPerWorkstream, 100);
    assert.equal(out.instanceTimeoutMs, 3_600_000);
    assert.equal(out.maxIterationsPerCall, 50);
  });

  it('respects explicit overrides', () => {
    const out = applySuiteDefaults(
      baseConfig({
        maxRunsPerWorkstream: 12,
        preflightCloneExplicit: true,
        preflightClone: false,
        dockerModeExplicit: true,
        dockerMode: 'off',
      }),
      'deepswe',
    );
    assert.equal(out.maxRunsPerWorkstream, 12);
    assert.equal(out.preflightClone, false);
    assert.equal(out.dockerMode, 'off');
  });

  it('no-preflight-clone opts out of default preflight', () => {
    const out = applySuiteDefaults(
      baseConfig({ noPreflightClone: true }),
      'deepswe',
    );
    assert.equal(out.preflightClone, false);
  });

  it('does not change swebench config', () => {
    const cfg = baseConfig({ preflightClone: false });
    const out = applySuiteDefaults(cfg, 'swebench');
    assert.equal(out.preflightClone, false);
    assert.equal(out.maxRunsPerWorkstream, 40);
  });
});
