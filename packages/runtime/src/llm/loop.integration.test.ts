import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import { installVcr, loadVcrConfig } from './vcr.js';

const here = dirname(fileURLToPath(import.meta.url));
const minimalCassette = join(here, 'fixtures', 'vcr-minimal.json');
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('loadVcrConfig resolves playback settings from env', () => {
  const config = loadVcrConfig({
    RUNTIME_VCR: 'playback',
    RUNTIME_VCR_CASSETTE: minimalCassette,
    RUNTIME_VCR_FILTER: '/chat/completions',
  });

  assert.ok(config);
  assert.equal(config!.mode, 'playback');
  assert.equal(config!.cassettePath, resolve(minimalCassette));
  assert.equal(config!.filter, '/chat/completions');
});

test('installVcr playback serves vcr-minimal fixture without network', async () => {
  if (!existsSync(minimalCassette)) {
    return;
  }

  const uninstall = installVcr({
    mode: 'playback',
    cassettePath: minimalCassette,
  });

  try {
    const response = await fetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test' }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
    };
    assert.equal(body.id, 'vcr-minimal-1');
    assert.equal(body.choices[0]!.message.content, 'ok');
  } finally {
    uninstall();
  }
});
