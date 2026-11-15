import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { serveUI } from './static.js';

describe('serveUI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artificer-static-'));
    fs.writeFileSync(
      path.join(tmpDir, 'index.html'),
      '<html><body>hello</body></html>',
    );
    fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'assets', 'app.js'),
      'console.log("hi")',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'assets', 'style.css'),
      'body { color: red }',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves index.html for root path', async () => {
    const app = new Hono();
    app.use('*', serveUI(tmpDir));

    const res = await app.request('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'text/html');
    const text = await res.text();
    assert.ok(text.includes('hello'));
  });

  it('serves static assets with correct content types', async () => {
    const app = new Hono();
    app.use('*', serveUI(tmpDir));

    const jsRes = await app.request('/assets/app.js');
    assert.equal(jsRes.status, 200);
    assert.equal(jsRes.headers.get('Content-Type'), 'application/javascript');

    const cssRes = await app.request('/assets/style.css');
    assert.equal(cssRes.status, 200);
    assert.equal(cssRes.headers.get('Content-Type'), 'text/css');
  });

  it('falls back to index.html for unknown paths (SPA routing)', async () => {
    const app = new Hono();
    app.use('*', serveUI(tmpDir));

    const res = await app.request('/some/client/route');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'text/html');
    const text = await res.text();
    assert.ok(text.includes('hello'));
  });

  it('passes through /api/ requests to next handler', async () => {
    const app = new Hono();
    app.use('*', serveUI(tmpDir));
    app.get('/api/health', (c) => c.text('ok'));

    const res = await app.request('/api/health');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  it('passes through /channels/ requests to next handler', async () => {
    const app = new Hono();
    app.use('*', serveUI(tmpDir));
    app.post('/channels/slack', (c) => c.text('slack'));

    const res = await app.request('/channels/slack', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'slack');
  });

  it('passes through /events requests to next handler', async () => {
    const app = new Hono();
    app.use('*', serveUI(tmpDir));
    app.get('/events', (c) => c.text('sse'));

    const res = await app.request('/events');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'sse');
  });
});
