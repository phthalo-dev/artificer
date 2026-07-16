import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runIdentityPullCycle } from './identity-pull.js';

describe('runIdentityPullCycle', () => {
  it('reloads schedules after an updated pull', async () => {
    let reloaded = 0;

    await runIdentityPullCycle({
      identity: {
        pullFromRemote: async () => 'updated',
      },
      reloadSchedules: () => {
        reloaded += 1;
      },
    });

    assert.equal(reloaded, 1);
  });

  it('does not reload schedules when the pull is unchanged', async () => {
    let reloaded = 0;

    await runIdentityPullCycle({
      identity: {
        pullFromRemote: async () => 'unchanged',
      },
      reloadSchedules: () => {
        reloaded += 1;
      },
    });

    assert.equal(reloaded, 0);
  });
});
