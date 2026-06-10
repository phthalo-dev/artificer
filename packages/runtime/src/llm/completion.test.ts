import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completionReminderText,
  isBlockedStatusText,
  plannerWritePlanReminderText,
  shellBrowseLoopWarningText,
  workerEditReminderText,
} from './completion.js';

test('completionReminderText names terminal worker tools', () => {
  const text = completionReminderText();
  assert.match(text, /declare_done/);
  assert.match(text, /declare_blocked/);
  assert.match(text, /verified=true/);
});

test('plannerWritePlanReminderText urges write_plan', () => {
  assert.match(plannerWritePlanReminderText(), /write_plan/);
});

test('workerEditReminderText urges edit_file', () => {
  assert.match(workerEditReminderText(), /edit_file/);
  assert.match(workerEditReminderText(), /read_file/);
});

test('shellBrowseLoopWarningText names the repeated file', () => {
  assert.match(shellBrowseLoopWarningText('src/maybe.ts'), /src\/maybe\.ts/);
});

test('isBlockedStatusText detects BLOCKED status line', () => {
  assert.equal(isBlockedStatusText('BLOCKED\nCould not reproduce the failure.'), true);
  assert.equal(isBlockedStatusText('Summary\n\nBLOCKED: missing dependency'), true);
  assert.equal(isBlockedStatusText('DONE\nAll tests passed.'), false);
});
