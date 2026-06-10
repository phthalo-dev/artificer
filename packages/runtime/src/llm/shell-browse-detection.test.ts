import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWorkerBrowseState,
  isShellBrowseCommand,
  recordWorkerToolCall,
  shellBrowseTarget,
} from './shell-browse-detection.js';

test('isShellBrowseCommand detects read patterns and skips builds', () => {
  assert.equal(isShellBrowseCommand("cd /app && sed -n '1,100p' src/maybe.ts"), true);
  assert.equal(isShellBrowseCommand('cd /app && grep -n foo src/maybe.ts'), true);
  assert.equal(isShellBrowseCommand('pnpm test'), false);
  assert.equal(isShellBrowseCommand('cd /app && cargo test'), false);
  assert.equal(isShellBrowseCommand('git diff src/maybe.ts'), false);
});

test('shellBrowseTarget normalizes repo and app paths', () => {
  assert.equal(
    shellBrowseTarget("cd /app && sed -n '1,100p' src/maybe.ts"),
    'src/maybe.ts',
  );
  assert.equal(
    shellBrowseTarget("sed -n '1,10p' repo/src/result.ts"),
    'src/result.ts',
  );
});

test('recordWorkerToolCall nudges after browse threshold without edit', () => {
  const state = createWorkerBrowseState();
  const config = { nudgeThreshold: 3, sameFileLoopThreshold: 3 };
  const cmd = { command: "cd /app && sed -n '1,50p' src/maybe.ts" };

  assert.equal(recordWorkerToolCall(state, 'run_shell', cmd, config).editNudge, false);
  assert.equal(recordWorkerToolCall(state, 'run_shell', cmd, config).editNudge, false);
  assert.equal(recordWorkerToolCall(state, 'run_shell', cmd, config).editNudge, true);
});

test('recordWorkerToolCall warns on same-file browse loop', () => {
  const state = createWorkerBrowseState();
  const config = { nudgeThreshold: 20, sameFileLoopThreshold: 3 };

  assert.equal(
    recordWorkerToolCall(
      state,
      'run_shell',
      { command: "sed -n '1,50p' src/maybe.ts" },
      config,
    ).sameFileLoopWarning,
    false,
  );
  assert.equal(
    recordWorkerToolCall(
      state,
      'run_shell',
      { command: "sed -n '51,100p' src/maybe.ts" },
      config,
    ).sameFileLoopWarning,
    false,
  );
  assert.equal(
    recordWorkerToolCall(
      state,
      'run_shell',
      { command: "grep foo src/maybe.ts" },
      config,
    ).sameFileLoopWarning,
    true,
  );
});

test('edit_file resets browse counters', () => {
  const state = createWorkerBrowseState();
  const config = { nudgeThreshold: 2, sameFileLoopThreshold: 2 };
  recordWorkerToolCall(
    state,
    'run_shell',
    { command: "sed -n '1,50p' src/maybe.ts" },
    config,
  );
  recordWorkerToolCall(state, 'edit_file', { path: 'src/maybe.ts' }, config);
  assert.equal(state.hasEdited, true);
  assert.equal(
    recordWorkerToolCall(
      state,
      'run_shell',
      { command: "sed -n '1,50p' src/maybe.ts" },
      config,
    ).editNudge,
    false,
  );
});
