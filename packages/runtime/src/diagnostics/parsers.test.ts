import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eslintJsonParser,
  makeExitCodeParser,
  makeRegexParser,
  ruffJsonParser,
  tscParser,
} from './parsers.js';

test('tscParser extracts file/line/col/code/message', () => {
  const stdout = [
    "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    'Found 1 error.',
  ].join('\n');
  const diags = tscParser({ stdout, stderr: '', code: 2 });
  assert.equal(diags.length, 1);
  assert.deepEqual(diags[0], {
    file: 'src/foo.ts',
    line: 12,
    column: 5,
    severity: 'error',
    message: "TS2322: Type 'string' is not assignable to type 'number'.",
    source: 'tsc',
  });
});

test('ruffJsonParser parses the JSON array form', () => {
  const stdout = JSON.stringify([
    {
      filename: '/ws/app.py',
      location: { row: 3, column: 1 },
      code: 'F401',
      message: "'os' imported but unused",
    },
  ]);
  const diags = ruffJsonParser({ stdout, stderr: '', code: 1 });
  assert.equal(diags.length, 1);
  assert.equal(diags[0].file, '/ws/app.py');
  assert.equal(diags[0].line, 3);
  assert.equal(diags[0].severity, 'error');
  assert.match(diags[0].message, /F401/);
  assert.equal(diags[0].source, 'ruff');
});

test('ruffJsonParser tolerates empty/non-JSON output', () => {
  assert.deepEqual(ruffJsonParser({ stdout: '', stderr: '', code: 0 }), []);
  assert.deepEqual(
    ruffJsonParser({ stdout: 'not json', stderr: '', code: 0 }),
    [],
  );
});

test('eslintJsonParser maps severity 2 to error and 1 to warning', () => {
  const stdout = JSON.stringify([
    {
      filePath: '/ws/a.ts',
      messages: [
        {
          line: 1,
          column: 1,
          severity: 2,
          message: 'no-undef',
          ruleId: 'no-undef',
        },
        {
          line: 2,
          column: 3,
          severity: 1,
          message: 'prefer-const',
          ruleId: 'prefer-const',
        },
      ],
    },
  ]);
  const diags = eslintJsonParser({ stdout, stderr: '', code: 1 });
  assert.equal(diags.length, 2);
  assert.equal(diags[0].severity, 'error');
  assert.equal(diags[1].severity, 'warning');
});

test('makeRegexParser uses named groups', () => {
  const parser = makeRegexParser(
    String.raw`^(?<file>.+?):(?<line>\d+):(?<col>\d+): (?<message>.+)$`,
    'golint',
  );
  const diags = parser({
    stdout: 'main.go:10:2: undefined: foo',
    stderr: '',
    code: 1,
  });
  assert.equal(diags.length, 1);
  assert.deepEqual(diags[0], {
    file: 'main.go',
    line: 10,
    column: 2,
    severity: 'error',
    message: 'undefined: foo',
    source: 'golint',
  });
});

test('makeExitCodeParser reports only on non-zero exit', () => {
  const parser = makeExitCodeParser('build');
  assert.deepEqual(parser({ stdout: '', stderr: '', code: 0 }), []);
  const diags = parser({ stdout: '', stderr: 'boom', code: 1 });
  assert.equal(diags.length, 1);
  assert.equal(diags[0].message, 'boom');
  assert.equal(diags[0].source, 'build');
});
