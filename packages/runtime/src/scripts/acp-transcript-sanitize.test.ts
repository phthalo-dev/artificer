import assert from 'node:assert/strict';
import { test } from 'vitest';
import { sanitizeTranscriptPaths } from './acp-transcript-sanitize.js';

test('replaces workspace, parent, and home, longest first', () => {
  const out = sanitizeTranscriptPaths(
    '/Users/me/dev/ws/a /Users/me/dev/b /Users/me/.config/opencode',
    { cwd: '/Users/me/dev/ws', parent: '/Users/me/dev', home: '/Users/me' },
  );
  assert.equal(out, '{{WS}}/a {{PARENT}}/b {{HOME}}/.config/opencode');
});

test('replaces home when the workspace is outside it', () => {
  const out = sanitizeTranscriptPaths('/tmp/x/ws/f /Users/me/.local', {
    cwd: '/tmp/x/ws',
    parent: '/tmp/x',
    home: '/Users/me',
  });
  assert.equal(out, '{{WS}}/f {{HOME}}/.local');
});
