import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SERVER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'mcp-status-server.mjs',
);

interface McpResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Spawn the server and drive it with a sequence of JSON-RPC messages. */
function driveServer(
  statusFile: string,
  messages: object[],
): Promise<McpResponse[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_PATH, statusFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses: McpResponse[] = [];
    let buf = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line) as McpResponse);
        } catch {
          /* ignore non-JSON */
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Allow stderr for debugging but don't fail on it
      process.stderr.write(chunk);
    });

    child.on('error', reject);

    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    }
    child.stdin.end();

    child.on('close', () => resolve(responses));

    setTimeout(() => {
      child.kill();
      reject(new Error('server timed out'));
    }, 5000);
  });
}

function tmpStatusFile(): string {
  return path.join(os.tmpdir(), `artificer-test-status-${Date.now()}.json`);
}

test('initialize returns protocol version and tool capability', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {} },
      },
    ]);
    assert.equal(responses.length, 1);
    const result = responses[0].result as Record<string, unknown>;
    assert.equal(result.protocolVersion, '2024-11-05');
    assert.ok((result.serverInfo as Record<string, unknown>).name);
    assert.ok((result.capabilities as Record<string, unknown>).tools);
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('tools/list returns report_status tool with correct schema', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const listResponse = responses.find((r) => r.id === 2);
    assert.ok(listResponse, 'missing tools/list response');
    const result = listResponse.result as { tools: Array<{ name: string }> };
    assert.ok(result.tools.some((t) => t.name === 'report_status'));
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('tools/call report_status writes status file and returns success', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'report_status',
          arguments: { status: 'done', summary: 'All tests pass.' },
        },
      },
    ]);
    const callResponse = responses.find((r) => r.id === 2);
    assert.ok(callResponse, 'missing tools/call response');
    assert.ok(
      !callResponse.error,
      `unexpected error: ${callResponse.error?.message}`,
    );
    const result = callResponse.result as {
      content: Array<{ type: string; text: string }>;
    };
    assert.equal(result.content[0].type, 'text');

    assert.ok(fs.existsSync(statusFile), 'status file not written');
    const written = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as Record<
      string,
      unknown
    >;
    assert.equal(written.status, 'done');
    assert.equal(written.summary, 'All tests pass.');
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('tools/call report_status persists followUps field', async () => {
  const statusFile = tmpStatusFile();
  try {
    await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'report_status',
          arguments: {
            status: 'done_with_concerns',
            summary: 'Done.',
            followUps: 'Add tests.',
          },
        },
      },
    ]);
    const written = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as Record<
      string,
      unknown
    >;
    assert.equal(written.status, 'done_with_concerns');
    assert.equal(written.followUps, 'Add tests.');
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('tools/call unknown tool returns error', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'nonexistent', arguments: {} },
      },
    ]);
    const callResponse = responses.find((r) => r.id === 2);
    assert.ok(callResponse?.error, 'expected error for unknown tool');
    assert.equal(callResponse.error?.code, -32601);
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('unknown method with id returns method-not-found error', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'foo/bar', params: {} },
    ]);
    const response = responses.find((r) => r.id === 2);
    assert.ok(response?.error, 'expected error for unknown method');
    assert.equal(response.error?.code, -32601);
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('notifications/initialized produces no response', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    // Should only see responses for id 1 and id 2, not for the notification
    const ids = responses.map((r) => r.id);
    assert.ok(
      !ids.includes(undefined as unknown as number),
      'notification should not produce a response id',
    );
    assert.ok(ids.includes(1));
    assert.ok(ids.includes(2));
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('tools/list includes report_status, submit_review, and publish_artifact', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const listResponse = responses.find((r) => r.id === 2);
    assert.ok(listResponse);
    const result = listResponse!.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    assert.ok(names.includes('report_status'));
    assert.ok(names.includes('submit_review'));
    assert.ok(names.includes('publish_artifact'));
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('tools/call publish_artifact appends an artifact JSON line', async () => {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'artificer-mcp-artifact-'),
  );
  const statusFile = path.join(dir, '.artificer-status.json');
  const artifactFile = path.join(dir, '.artificer-artifacts.jsonl');
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'publish_artifact',
          arguments: { key: 'note', name: 'Note', content: 'hello' },
        },
      },
    ]);
    const callResponse = responses.find((r) => r.id === 2);
    assert.ok(
      !callResponse?.error,
      `unexpected error: ${callResponse?.error?.message}`,
    );

    const lines = fs
      .readFileSync(artifactFile, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(lines, [{ key: 'note', name: 'Note', content: 'hello' }]);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('tools/call submit_review writes review to status file', async () => {
  const statusFile = tmpStatusFile();
  try {
    const responses = await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'submit_review',
          arguments: {
            target: 'work',
            notes: 'LGTM.',
            approved: true,
            stage: 'work',
            severity: 'none',
          },
        },
      },
    ]);
    const callResponse = responses.find((r) => r.id === 2);
    assert.ok(
      !callResponse?.error,
      `unexpected error: ${callResponse?.error?.message}`,
    );

    assert.ok(fs.existsSync(statusFile));
    const written = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as Record<
      string,
      unknown
    >;
    assert.equal(written.tool, 'submit_review');
    assert.equal(written.approved, true);
    assert.equal(written.stage, 'work');
    assert.equal(written.severity, 'none');
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('submit_review and report_status write tool discriminator', async () => {
  const statusFile = tmpStatusFile();
  try {
    await driveServer(statusFile, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'report_status',
          arguments: { status: 'done', summary: 'Done.' },
        },
      },
    ]);
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8')) as Record<
      string,
      unknown
    >;
    assert.equal(status.tool, 'report_status');
    assert.equal(status.status, 'done');
  } finally {
    fs.rmSync(statusFile, { force: true });
  }
});

test('exits with error when no status file arg provided', async () => {
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [SERVER_PATH], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code ?? 1));
    setTimeout(() => {
      child.kill();
      resolve(1);
    }, 3000);
  });
  assert.equal(exitCode, 1);
});
