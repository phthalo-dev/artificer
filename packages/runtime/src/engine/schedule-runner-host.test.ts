import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import { Store } from '../storage/store.js';

describe('schedule runner host terminal checks', () => {
  it('waits for communicator runs and recognizes terminal statuses', async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), 'artificer-schedules-'),
    );
    try {
      const store = new Store(tempDir);
      await store.init();
      const messageId = 'msg_schedule';
      const workstream = await store.createWorkstream({
        title: 'Scheduled work',
        goal: 'Finish the work',
      });
      const communicatorRun = await store.createRun({
        role: 'communicator',
        task: 'Scheduled message',
        originMessageId: messageId,
      });

      const host = await import('./schedule-runner-host.js').catch(() => null);
      assert.ok(host, 'schedule runner host should be available');

      assert.equal(await host.communicatorRunTerminal(store, messageId), false);
      assert.equal(
        await host.communicatorRunTerminal(store, 'msg_missing'),
        false,
      );
      assert.equal(await host.workstreamTerminal(store, workstream.id), false);

      communicatorRun.status = 'failed';
      await store.saveRun(communicatorRun);
      await store.updateWorkstream(workstream.id, { status: 'cancelled' });

      assert.equal(await host.communicatorRunTerminal(store, messageId), true);
      assert.equal(await host.workstreamTerminal(store, workstream.id), true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
