import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDiagnostics } from './service.js';
import type { DiagnosticsConfig, ExecResult } from './types.js';

const BASE_CONFIG: DiagnosticsConfig = {
  enabled: true,
  timeoutMs: 1000,
  maxPerFile: 20,
  typescript: true,
};

/** Build a fake exec/which surface from a command → result map. */
function fakeSurface(opts: {
  bins: string[];
  responses: Array<{ match: RegExp; result: ExecResult }>;
}) {
  const bins = new Set(opts.bins);
  return {
    async which(binary: string) {
      return bins.has(binary);
    },
    async exec(command: string): Promise<ExecResult> {
      for (const { match, result } of opts.responses) {
        if (match.test(command)) return result;
      }
      return { stdout: '', stderr: '', code: 0 };
    },
  };
}

test('returns empty when diagnostics are disabled', async () => {
  const out = await runDiagnostics(
    { ...BASE_CONFIG, enabled: false },
    { workspaceDir: '/ws', env: {}, files: ['app.py'] },
  );
  assert.equal(out, '');
});

test('returns empty when no provider matches the file', async () => {
  const out = await runDiagnostics(BASE_CONFIG, {
    workspaceDir: '/ws',
    env: {},
    files: ['notes.md'],
    ...fakeSurface({ bins: [], responses: [] }),
  });
  assert.equal(out, '');
});

test('reports ruff errors for an edited python file', async () => {
  const ruffOut = JSON.stringify([
    {
      filename: '/ws/app.py',
      location: { row: 1, column: 1 },
      code: 'F401',
      message: "'os' imported but unused",
    },
  ]);
  const out = await runDiagnostics(BASE_CONFIG, {
    workspaceDir: '/ws',
    env: {},
    files: ['app.py'],
    ...fakeSurface({
      bins: ['ruff', 'python3'],
      responses: [{ match: /ruff check/, result: { stdout: ruffOut, stderr: '', code: 1 } }],
    }),
  });
  assert.match(out, /Diagnostics \(python\)/);
  assert.match(out, /F401/);
});

test('filters out diagnostics for files that were not edited', async () => {
  const ruffOut = JSON.stringify([
    {
      filename: '/ws/other.py',
      location: { row: 1, column: 1 },
      code: 'F401',
      message: 'unrelated error',
    },
  ]);
  const out = await runDiagnostics(BASE_CONFIG, {
    workspaceDir: '/ws',
    env: {},
    files: ['app.py'],
    ...fakeSurface({
      bins: ['ruff'],
      responses: [{ match: /ruff check/, result: { stdout: ruffOut, stderr: '', code: 1 } }],
    }),
  });
  assert.equal(out, '');
});

test('skips a provider whose toolchain is unavailable', async () => {
  const out = await runDiagnostics(BASE_CONFIG, {
    workspaceDir: '/ws',
    env: {},
    files: ['app.py'],
    ...fakeSurface({ bins: [], responses: [] }),
  });
  assert.equal(out, '');
});

test('consumer declarative provider runs and is reported', async () => {
  const out = await runDiagnostics(
    {
      ...BASE_CONFIG,
      providers: [
        {
          id: 'go',
          extensions: ['.go'],
          availableWhen: 'go',
          command: 'go vet ./...',
          parser: 'regex',
          pattern: String.raw`^(?<file>.+?):(?<line>\d+):(?<col>\d+): (?<message>.+)$`,
        },
      ],
    },
    {
      workspaceDir: '/ws',
      env: {},
      files: ['main.go'],
      ...fakeSurface({
        bins: ['go'],
        responses: [
          { match: /go vet/, result: { stdout: '/ws/main.go:10:2: undefined: foo', stderr: '', code: 1 } },
        ],
      }),
    },
  );
  assert.match(out, /Diagnostics \(go\)/);
  assert.match(out, /undefined: foo/);
});
