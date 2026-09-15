import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  loadWorkspaceServiceConfig,
  resolveServiceConfig,
} from './workspace-config.js';

function writeConfig(repoRoot: string, content: string): void {
  const dir = path.join(repoRoot, '.artificer');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'workspace.json'), content);
}

test('loadWorkspaceServiceConfig returns undefined when the file is missing', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wsc-'));
  assert.equal(loadWorkspaceServiceConfig(repoRoot), undefined);
});

test('loadWorkspaceServiceConfig returns undefined on invalid JSON', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wsc-'));
  writeConfig(repoRoot, '{not json');
  assert.equal(loadWorkspaceServiceConfig(repoRoot), undefined);
});

test('loadWorkspaceServiceConfig parses a valid file', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-wsc-'));
  writeConfig(
    repoRoot,
    JSON.stringify({
      services: { web: { run: 'npm run dev', portRange: [3000, 3009] } },
    }),
  );
  const parsed = loadWorkspaceServiceConfig(repoRoot);
  assert.deepEqual(parsed?.services.web, {
    run: 'npm run dev',
    portRange: [3000, 3009],
  });
});

test('resolveServiceConfig returns undefined for an unknown name', () => {
  const file = {
    services: {
      web: { run: 'npm run dev', portRange: [3000, 3009] as [number, number] },
    },
  };
  assert.equal(resolveServiceConfig(file, 'worker'), undefined);
});

test('resolveServiceConfig returns undefined for a disabled name', () => {
  const file = {
    services: {
      web: { run: 'npm run dev', portRange: [3000, 3009] as [number, number] },
    },
  };
  assert.equal(
    resolveServiceConfig(file, 'web', { disabled: ['web'] }),
    undefined,
  );
});

test('resolveServiceConfig applies a field override', () => {
  const file = {
    services: {
      web: { run: 'npm run dev', portRange: [3000, 3009] as [number, number] },
    },
  };
  const resolved = resolveServiceConfig(file, 'web', {
    overrides: { web: { portRange: [4000, 4009] } },
  });
  assert.deepEqual(resolved, { run: 'npm run dev', portRange: [4000, 4009] });
});
