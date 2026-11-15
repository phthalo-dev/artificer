import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';

test('the config schema requires id, url, and baseBranch on repos', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      new URL('../../artificer.config.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const repos = schema.properties.repos;
  assert.equal(repos.type, 'array');
  assert.deepEqual(repos.items.required, ['id', 'url', 'baseBranch']);
});

test('the acp preset branch does not accept args', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      new URL('../../artificer.config.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const found: Array<Record<string, any>> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, any>;
    if (n.properties?.type?.const === 'acp' && n.properties?.agent) {
      found.push(n);
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(schema);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.additionalProperties, false);
  assert.equal(found[0]!.properties.args, undefined);
});
