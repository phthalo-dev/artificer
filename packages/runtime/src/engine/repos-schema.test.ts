import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('the config schema requires id, url, and baseBranch on repos', () => {
  const schema = JSON.parse(
    fs.readFileSync(new URL('../../artificer.config.schema.json', import.meta.url), 'utf8'),
  );
  const repos = schema.properties.repos;
  assert.equal(repos.type, 'array');
  assert.deepEqual(repos.items.required, ['id', 'url', 'baseBranch']);
});
