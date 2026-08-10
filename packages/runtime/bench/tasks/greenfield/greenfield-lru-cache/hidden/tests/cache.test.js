import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from '../src/lru-cache.js';
import { TTLCache } from '../src/ttl-cache.js';

test('LRUCache constructor rejects a non-positive-integer capacity', () => {
  assert.throws(() => new LRUCache(0));
  assert.throws(() => new LRUCache(-1));
  assert.throws(() => new LRUCache(1.5));
});

test('LRUCache get/set round-trips a value', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
});

test('LRUCache get on a missing key returns undefined', () => {
  const cache = new LRUCache(2);
  assert.equal(cache.get('missing'), undefined);
});

test('LRUCache evicts the least-recently-used entry when over capacity', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3); // evicts 'a' (least recently used)
  assert.equal(cache.has('a'), false);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size, 2);
});

test('LRUCache#get refreshes recency, protecting a key from eviction', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // 'a' is now most recently used; 'b' is now LRU
  cache.set('c', 3); // evicts 'b', not 'a'
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
});

test('LRUCache#set on an existing key updates the value and refreshes recency without growing size', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 100); // update + refresh 'a'
  assert.equal(cache.size, 2);
  cache.set('c', 3); // evicts 'b', since 'a' was just refreshed
  assert.equal(cache.get('a'), 100);
  assert.equal(cache.has('b'), false);
});

test('LRUCache#has does not affect recency', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.has('a'); // must NOT protect 'a' from eviction
  cache.set('c', 3); // evicts 'a', the true least-recently-used
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
});

test('LRUCache#delete removes an entry and frees capacity', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.delete('a'), false);
  assert.equal(cache.size, 1);
  cache.set('c', 3);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
});

test('TTLCache set requires a positive numeric ttlMs', () => {
  const cache = new TTLCache();
  assert.throws(() => cache.set('a', 1, 0));
  assert.throws(() => cache.set('a', 1, -5));
  assert.throws(() => cache.set('a', 1));
});

test('TTLCache get returns the value before expiry and undefined after', () => {
  let t = 0;
  const cache = new TTLCache({ now: () => t });
  cache.set('a', 'value', 100);
  t = 50;
  assert.equal(cache.get('a'), 'value');
  t = 100;
  assert.equal(cache.get('a'), undefined);
});

test('TTLCache has reflects expiry the same way get does', () => {
  let t = 0;
  const cache = new TTLCache({ now: () => t });
  cache.set('a', 'value', 100);
  t = 99;
  assert.equal(cache.has('a'), true);
  t = 100;
  assert.equal(cache.has('a'), false);
});

test('TTLCache size only counts entries that have not expired yet', () => {
  let t = 0;
  const cache = new TTLCache({ now: () => t });
  cache.set('a', 1, 50);
  cache.set('b', 2, 200);
  t = 100;
  assert.equal(cache.size, 1);
  assert.equal(cache.has('b'), true);
});

test('TTLCache delete removes an entry regardless of expiry', () => {
  let t = 0;
  const cache = new TTLCache({ now: () => t });
  cache.set('a', 1, 50);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.delete('a'), false);
  assert.equal(cache.has('a'), false);
});
