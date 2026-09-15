import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Layout } from './layout.js';

test('workstreamServicesStateFile is under the workstream workspace', () => {
  const layout = new Layout('/data');
  assert.equal(
    layout.workstreamServicesStateFile('ws1'),
    path.join('/data', 'workspace', 'ws1', '.artificer-services.json'),
  );
});

test('workstreamServiceLogFile is under the service logs dir', () => {
  const layout = new Layout('/data');
  assert.equal(
    layout.workstreamServiceLogFile('ws1', 'web'),
    path.join(
      '/data',
      'workspace',
      'ws1',
      '.artificer-service-logs',
      'web.log',
    ),
  );
});
