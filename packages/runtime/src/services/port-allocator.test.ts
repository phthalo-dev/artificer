import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { PortAllocator } from './port-allocator.js';

test('allocate returns the first free port in range', async () => {
  const allocator = new PortAllocator();
  const port = await allocator.allocate({ min: 41000, max: 41005 });
  assert.ok(port >= 41000 && port <= 41005);
});

test('allocate skips already-claimed ports', async () => {
  const allocator = new PortAllocator();
  const first = await allocator.allocate({ min: 41010, max: 41015 });
  const second = await allocator.allocate({ min: 41010, max: 41015 });
  assert.notEqual(first, second);
});

test('release lets a port be claimed again', async () => {
  const allocator = new PortAllocator();
  const first = await allocator.allocate({ min: 41020, max: 41020 });
  allocator.release(first);
  const second = await allocator.allocate({ min: 41020, max: 41020 });
  assert.equal(first, second);
});

test('allocate throws when the range is exhausted', async () => {
  const allocator = new PortAllocator();
  await allocator.allocate({ min: 41030, max: 41030 });
  await assert.rejects(
    () => allocator.allocate({ min: 41030, max: 41030 }),
    /No free port in range 41030-41030/,
  );
});

test('concurrent allocate calls never return the same port (check-then-act race)', async () => {
  const allocator = new PortAllocator();
  const N = 8;
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      allocator.allocate({ min: 41050, max: 41050 + N - 1 }),
    ),
  );
  assert.equal(
    new Set(results).size,
    N,
    `expected ${N} distinct ports, got ${JSON.stringify(results)}`,
  );
});

test('concurrent allocate calls never return the same port, even when the underlying port probe is slow', async () => {
  // A real net.createServer() probe gives concurrent calls an incidental
  // second line of defense: two concurrent listen() calls for the exact
  // same live port can't both succeed at the OS level, so the test above
  // can pass even on the pre-fix code (confirmed by temporarily reverting
  // the fix - see report). Stubbing the probe to report "free" after a
  // delay isolates the in-memory claim-then-probe race itself: without
  // claiming the candidate port BEFORE awaiting the probe, every
  // concurrent caller's loop starts at `range.min`, sees it unclaimed, and
  // converges on the same port once the stub resolves.
  const allocator = new PortAllocator();
  (
    allocator as unknown as { isPortFree: (port: number) => Promise<boolean> }
  ).isPortFree = (_port: number) =>
    new Promise((resolve) => setTimeout(() => resolve(true), 5));

  const N = 8;
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      allocator.allocate({ min: 41060, max: 41060 + N - 1 }),
    ),
  );
  assert.equal(
    new Set(results).size,
    N,
    `expected ${N} distinct ports, got ${JSON.stringify(results)}`,
  );
});

test('allocate skips a port actually in use by another process', async () => {
  const blocker = net.createServer();
  await new Promise<void>((resolve) =>
    blocker.listen(41040, '127.0.0.1', resolve),
  );
  try {
    const allocator = new PortAllocator();
    const port = await allocator.allocate({ min: 41040, max: 41041 });
    assert.equal(port, 41041);
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});
