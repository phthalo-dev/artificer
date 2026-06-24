import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineConnection } from './define-connection.js';

describe('defineConnection', () => {
  it('creates an MCP connection definition', () => {
    const conn = defineConnection({
      type: 'mcp',
      name: 'linear',
      description: 'Linear project management',
      url: 'https://mcp.linear.app',
      auth: { type: 'bearer', envVar: 'LINEAR_API_KEY' },
    });

    assert.equal(conn.name, 'linear');
    assert.equal(conn.definition.type, 'mcp');
    assert.equal(conn.definition.auth?.envVar, 'LINEAR_API_KEY');
  });

  it('creates an OpenAPI connection definition', () => {
    const conn = defineConnection({
      type: 'openapi',
      name: 'jira',
      description: 'JIRA issue tracking',
      url: 'https://acme.atlassian.net/rest/api/2',
      specUrl: 'https://acme.atlassian.net/openapi.json',
      auth: { type: 'basic', envVar: 'JIRA_TOKEN' },
      operations: { allow: ['searchIssues', 'getIssue', 'createIssue'] },
    });

    assert.equal(conn.name, 'jira');
    assert.equal(conn.definition.type, 'openapi');
    assert.deepEqual(
      (conn.definition.operations as { allow: string[] }).allow,
      ['searchIssues', 'getIssue', 'createIssue'],
    );
  });

  it('supports header-based auth', () => {
    const conn = defineConnection({
      type: 'mcp',
      name: 'custom',
      description: 'Custom service',
      url: 'http://localhost:3000/mcp',
      auth: { type: 'header', name: 'X-API-Key', envVar: 'CUSTOM_KEY' },
    });

    assert.equal(conn.definition.auth?.type, 'header');
    assert.equal(conn.definition.auth?.name, 'X-API-Key');
  });
});
