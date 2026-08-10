import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/router.js';
import { MiddlewareChain } from '../src/middleware.js';
import { parseQuery, parsePath } from '../src/request.js';
import { json, text, notFound, serverError } from '../src/response.js';
import { App } from '../src/app.js';

// --- router.js ---

test('Router matches an exact path with no params', () => {
  const r = new Router();
  const h = () => 'handler';
  r.route('GET', '/health', h);
  const m = r.match('GET', '/health');
  assert.equal(m.handler, h);
  assert.deepEqual(m.params, {});
});

test('Router extracts :param segments', () => {
  const r = new Router();
  const h = () => {};
  r.route('GET', '/users/:id/posts/:postId', h);
  const m = r.match('GET', '/users/42/posts/7');
  assert.deepEqual(m.params, { id: '42', postId: '7' });
});

test('Router#match is method-sensitive and returns undefined on no match', () => {
  const r = new Router();
  r.route('GET', '/users/:id', () => {});
  assert.equal(r.match('POST', '/users/42'), undefined);
  assert.equal(r.match('GET', '/nope'), undefined);
  assert.equal(r.match('GET', '/users/42/extra'), undefined);
});

test('Router method matching is case-insensitive', () => {
  const r = new Router();
  r.route('get', '/x', () => 'lower');
  assert.notEqual(r.match('GET', '/x'), undefined);
  assert.notEqual(r.match('get', '/x'), undefined);

  const r2 = new Router();
  r2.route('GET', '/y', () => 'upper');
  assert.notEqual(r2.match('get', '/y'), undefined);
});

test('Router#route registering the same method+path twice replaces the handler', () => {
  const r = new Router();
  r.route('GET', '/x', () => 'first');
  r.route('GET', '/x', () => 'second');
  const m = r.match('GET', '/x');
  assert.equal(m.handler(), 'second');
});

// --- middleware.js ---

test('MiddlewareChain runs middlewares in registration order, then the final handler', async () => {
  const chain = new MiddlewareChain();
  const order = [];
  chain.use(async (ctx, next) => {
    order.push('a');
    await next();
  });
  chain.use(async (ctx, next) => {
    order.push('b');
    await next();
  });
  await chain.run({}, async () => {
    order.push('final');
  });
  assert.deepEqual(order, ['a', 'b', 'final']);
});

test('MiddlewareChain stops when a middleware does not call next()', async () => {
  const chain = new MiddlewareChain();
  const order = [];
  chain.use(async (ctx, next) => {
    order.push('a');
    // does not call next()
  });
  chain.use(async (ctx, next) => {
    order.push('b');
    await next();
  });
  await chain.run({}, async () => {
    order.push('final');
  });
  assert.deepEqual(order, ['a']);
});

test('MiddlewareChain throws if next() is called more than once', async () => {
  const chain = new MiddlewareChain();
  chain.use(async (ctx, next) => {
    await next();
    await next();
  });
  await assert.rejects(chain.run({}, async () => {}));
});

test('MiddlewareChain#run rejects when a middleware throws, and later steps never run', async () => {
  const chain = new MiddlewareChain();
  const order = [];
  chain.use(async () => {
    order.push('a');
    throw new Error('boom');
  });
  chain.use(async (ctx, next) => {
    order.push('b');
    await next();
  });
  await assert.rejects(
    chain.run({}, async () => {
      order.push('final');
    }),
    /boom/,
  );
  assert.deepEqual(order, ['a']);
});

// --- request.js ---

test('parseQuery parses simple key=value pairs', () => {
  assert.deepEqual(parseQuery('a=1&b=2'), { a: '1', b: '2' });
});

test('parseQuery collects repeated keys into an array', () => {
  assert.deepEqual(parseQuery('tag=x&tag=y&tag=z'), { tag: ['x', 'y', 'z'] });
});

test('parseQuery URI-decodes keys and values, and handles empty/valueless pairs', () => {
  assert.deepEqual(parseQuery('name=John%20Doe&flag'), { name: 'John Doe', flag: '' });
  assert.deepEqual(parseQuery(''), {});
});

test('parsePath splits the path from the query string', () => {
  assert.deepEqual(parsePath('/users/42?a=1&b=2'), { path: '/users/42', query: 'a=1&b=2' });
  assert.deepEqual(parsePath('/users/42'), { path: '/users/42', query: '' });
});

// --- response.js ---

test('response builders produce the expected shapes', () => {
  assert.deepEqual(json(201, { ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  });
  assert.deepEqual(text(200, 'hi'), {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'hi',
  });
  assert.equal(notFound().status, 404);
  assert.equal(serverError('oops').status, 500);
  assert.deepEqual(JSON.parse(serverError('oops').body), { error: 'oops' });
});

// --- app.js: cross-file integration ---

test('App: a GET route handler receives extracted params and query, via handle()', async () => {
  const app = new App();
  app.get('/users/:id', async (ctx) => {
    return json(200, { id: ctx.params.id, active: ctx.query.active });
  });
  const res = await app.handle({ method: 'GET', url: '/users/42?active=true' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { id: '42', active: 'true' });
});

test('App: an unmatched route returns 404 through handle(), not a thrown error', async () => {
  const app = new App();
  app.get('/known', async () => json(200, {}));
  const res = await app.handle({ method: 'GET', url: '/unknown' });
  assert.equal(res.status, 404);
});

test('App: middleware can short-circuit the chain and set the response itself', async () => {
  const app = new App();
  let handlerRan = false;
  app.use(async (ctx, next) => {
    if (ctx.query.token === undefined) {
      ctx.response = json(401, { error: 'unauthorized' });
      return; // does not call next()
    }
    await next();
  });
  app.get('/secret', async () => {
    handlerRan = true;
    return json(200, { secret: true });
  });
  const res = await app.handle({ method: 'GET', url: '/secret' });
  assert.equal(res.status, 401);
  assert.equal(handlerRan, false);
});

test('App: an error thrown by a middleware becomes a 500 response, handle() never rejects', async () => {
  const app = new App();
  app.use(async () => {
    throw new Error('middleware exploded');
  });
  app.get('/x', async () => json(200, {}));
  const res = await app.handle({ method: 'GET', url: '/x' });
  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(res.body), { error: 'middleware exploded' });
});

test('App: an error thrown by the route handler itself also becomes a 500 response', async () => {
  const app = new App();
  app.get('/x', async () => {
    throw new Error('handler exploded');
  });
  const res = await app.handle({ method: 'GET', url: '/x' });
  assert.equal(res.status, 500);
});

test('App: multiple middlewares run in order before a POST handler', async () => {
  const app = new App();
  const order = [];
  app.use(async (ctx, next) => {
    order.push('first');
    await next();
  });
  app.use(async (ctx, next) => {
    order.push('second');
    await next();
  });
  app.post('/create', async () => {
    order.push('handler');
    return json(201, {});
  });
  const res = await app.handle({ method: 'POST', url: '/create' });
  assert.equal(res.status, 201);
  assert.deepEqual(order, ['first', 'second', 'handler']);
});
