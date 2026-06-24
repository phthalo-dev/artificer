import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { bearerAuth } from './auth.js';

describe('bearerAuth', () => {
  it('passes through when no key is configured', async () => {
    const app = new Hono();
    app.use('*', bearerAuth(undefined));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  it('rejects requests without a token when key is configured', async () => {
    const app = new Hono();
    app.use('*', bearerAuth('secret-key'));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test');
    assert.equal(res.status, 401);
  });

  it('rejects requests with wrong token', async () => {
    const app = new Hono();
    app.use('*', bearerAuth('secret-key'));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    assert.equal(res.status, 401);
  });

  it('accepts requests with correct token', async () => {
    const app = new Hono();
    app.use('*', bearerAuth('secret-key'));
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer secret-key' },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });
});
