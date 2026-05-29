import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertPublicUrl,
  isBlockedAddress,
  isBlockedHostname,
} from './url-guard.js';

test('isBlockedAddress flags private/loopback/link-local/metadata IPs', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedAddress allows public IPs', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test('isBlockedHostname flags local suffixes', () => {
  for (const h of ['localhost', 'foo.localhost', 'db.local', 'svc.internal']) {
    assert.equal(isBlockedHostname(h), true, h);
  }
  assert.equal(isBlockedHostname('example.com'), false);
});

test('assertPublicUrl rejects non-http(s) and local/literal-private targets', async () => {
  await assert.rejects(() => assertPublicUrl('ftp://example.com'), /http\(s\)/);
  await assert.rejects(() => assertPublicUrl('http://localhost/x'), /internal host/);
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/x'), /non-public/);
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data'), /non-public/);
  await assert.rejects(() => assertPublicUrl('not a url'), /invalid URL/);
});

test('assertPublicUrl accepts a public literal IP', async () => {
  const u = await assertPublicUrl('https://8.8.8.8/');
  assert.equal(u.hostname, '8.8.8.8');
});

test('isBlockedAddress flags hex IPv4-mapped loopback', () => {
  assert.equal(isBlockedAddress('::ffff:7f00:1'), true);
});

test('assertPublicUrl handles bracketed IPv6 literals', async () => {
  await assert.rejects(() => assertPublicUrl('http://[::1]/'), /non-public/);
  const u = await assertPublicUrl('http://[2001:4860:4860::8888]/');
  assert.equal(u.hostname, '[2001:4860:4860::8888]');
});
