import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { installVcr, type VcrRecording } from './vcr.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('playback returns recorded body from preloaded cassette', async () => {
  const cassette: VcrRecording[] = [
    {
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      status: 200,
      body: JSON.stringify({ id: 'rec-1', choices: [{ message: { content: 'hello' } }] }),
      headers: { 'content-type': 'application/json' },
    },
  ];

  const dir = mkdtempSync(join(tmpdir(), 'runtime-vcr-'));
  const cassettePath = join(dir, 'cassette.json');
  writeFileSync(cassettePath, JSON.stringify(cassette));

  const uninstall = installVcr({ mode: 'playback', cassettePath });
  try {
    const response = await fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'test' }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    assert.equal(body.choices[0].message.content, 'hello');
  } finally {
    uninstall();
  }
});

test('playback throws when no matching recording exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-vcr-'));
  const cassettePath = join(dir, 'empty.json');
  writeFileSync(cassettePath, '[]');

  const uninstall = installVcr({ mode: 'playback', cassettePath });
  try {
    await assert.rejects(
      () => fetch('https://api.example.com/v1/missing'),
      /No matching recording/,
    );
  } finally {
    uninstall();
  }
});

test('filter passes non-matching requests through during playback', async () => {
  const cassette: VcrRecording[] = [
    {
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      status: 200,
      body: '{"ok":true}',
    },
  ];

  const dir = mkdtempSync(join(tmpdir(), 'runtime-vcr-'));
  const cassettePath = join(dir, 'filtered.json');
  writeFileSync(cassettePath, JSON.stringify(cassette));

  globalThis.fetch = async () =>
    new Response('passthrough', { status: 418 });

  const uninstall = installVcr({
    mode: 'playback',
    cassettePath,
    filter: '/chat/completions',
  });
  try {
    const response = await fetch('https://api.example.com/health');
    assert.equal(response.status, 418);
    assert.equal(await response.text(), 'passthrough');
  } finally {
    uninstall();
  }
});
