import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { QuotaLedger } from './quota-ledger.js';
import type { QuotaConfig } from './quota-types.js';

const baseConfig: QuotaConfig = {
  reservePercent: 10,
  defaultEstimateDollars: { low: 0.02, medium: 0.15, high: 0.5 },
  accounts: [
    {
      id: 'test-metered',
      mode: 'metered',
      windows: [
        {
          id: 'daily',
          unit: 'dollars',
          period: 'daily',
          scope: 'global',
          limit: 10,
          warnAtPercent: 70,
          blockAtPercent: 90,
        },
      ],
    },
    {
      id: 'test-opaque',
      mode: 'opaque',
      unitWeights: { worker: 1, planner: 1.5 },
      windows: [
        {
          id: 'weekly',
          unit: 'requests',
          period: 'weekly',
          scope: 'global',
          limit: 10,
          blockAtPercent: 90,
        },
      ],
    },
  ],
};

function tempStatePath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'quota-ledger-')),
    'quota-state.json',
  );
}

test('canDispatch blocks work roles at reserve-adjusted cap', () => {
  const ledger = QuotaLedger.load(baseConfig, tempStatePath());
  ledger.addUsage('test-metered', 8.5, undefined, 'metered');
  assert.equal(
    ledger.canDispatch('test-metered', 0.2, 'worker', undefined),
    false,
  );
  assert.equal(
    ledger.canDispatch('test-metered', 0.2, 'communicator', undefined, {
      useReserve: true,
    }),
    true,
  );
});

test('recordExecutorInvocation increments opaque account', () => {
  const ledger = QuotaLedger.load(baseConfig, tempStatePath());
  ledger.recordExecutorInvocation('test-opaque', 'planner');
  const snap = ledger.snapshot();
  const account = snap.accounts['test-opaque'];
  assert.equal(account.windows[0].used, 1.5);
});

test('resetWindow clears fixed global usage', () => {
  const statePath = tempStatePath();
  const config: QuotaConfig = {
    accounts: [
      {
        id: 'session',
        mode: 'metered',
        windows: [
          {
            id: 'bench',
            unit: 'dollars',
            period: 'fixed',
            scope: 'global',
            limit: 5,
            blockAtPercent: 100,
          },
        ],
      },
    ],
  };
  const ledger = QuotaLedger.load(config, statePath);
  ledger.addUsage('session', 4, undefined, 'metered');
  assert.equal(ledger.canDispatch('session', 2, 'worker'), false);
  assert.equal(ledger.resetWindow('session', 'bench'), true);
  assert.equal(ledger.canDispatch('session', 2, 'worker'), true);
});

test('persists state to disk', () => {
  const statePath = tempStatePath();
  const ledger = QuotaLedger.load(baseConfig, statePath);
  ledger.addUsage('test-metered', 1, undefined, 'metered');
  const reloaded = QuotaLedger.load(baseConfig, statePath);
  assert.equal(reloaded.snapshot().accounts['test-metered'].windows[0].used, 1);
});

test('markAccountExhausted fills rolling5h entries so dispatch blocks', () => {
  const config: QuotaConfig = {
    accounts: [
      {
        id: 'go',
        mode: 'windowed',
        windows: [
          {
            id: 'rolling5h',
            unit: 'dollars',
            period: 'rolling5h',
            scope: 'global',
            limit: 12,
            blockAtPercent: 90,
          },
        ],
      },
    ],
  };
  const ledger = QuotaLedger.load(config, tempStatePath());
  assert.equal(ledger.canDispatch('go', 0.5, 'worker'), true);
  ledger.markAccountExhausted('go');
  assert.equal(ledger.isAccountExhausted('go'), true);
  assert.equal(ledger.canDispatch('go', 0.01, 'worker'), false);
  const window = ledger.snapshot().accounts.go!.windows[0]!;
  assert.equal(window.used, 12);
  assert.ok(window.rollingEntries.length > 0);
});
