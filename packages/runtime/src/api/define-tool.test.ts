import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defineTool } from './define-tool.js';
import { ToolRegistry } from './tool-registry.js';

describe('defineTool', () => {
  it('creates a tool with name and description', () => {
    const tool = defineTool({
      name: 'get_weather',
      description: 'Get weather for a city',
      input: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      execute: async (input) => `Sunny in ${input.city}`,
    });

    assert.equal(tool.name, 'get_weather');
    assert.equal(tool.definition.description, 'Get weather for a city');
  });

  it('converts to internal ToolDef', () => {
    const tool = defineTool({
      name: 'greet',
      description: 'Say hello',
      input: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      execute: async (input) => `Hello ${input.name}`,
    });

    const toolDef = tool.toToolDef({} as any);
    assert.equal(toolDef.name, 'greet');
    assert.equal(typeof toolDef.handler, 'function');
  });

  it('preserves needsApproval true on toToolDef', () => {
    const tool = defineTool({
      name: 'deploy',
      description: 'Deploy',
      input: { type: 'object', properties: {}, required: [] },
      needsApproval: true,
      execute: async () => 'ok',
    });

    assert.equal(tool.toToolDef({} as any).needsApproval, true);
  });

  it('preserves needsApproval function on toToolDef', () => {
    const needsApproval = (input: { force?: boolean }) => input.force === true;
    const tool = defineTool({
      name: 'deploy',
      description: 'Deploy',
      input: {
        type: 'object',
        properties: { force: { type: 'boolean' } },
      },
      needsApproval,
      execute: async () => 'ok',
    });

    assert.equal(tool.toToolDef({} as any).needsApproval, needsApproval);
  });

  it('respects role scoping', () => {
    const tool = defineTool({
      name: 'deploy',
      description: 'Deploy to production',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker'],
      execute: async () => 'deployed',
    });

    assert.deepEqual(tool.definition.roles, ['worker']);
  });
});

describe('ToolRegistry', () => {
  it('registers tools and retrieves by role', () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: 'custom',
      description: 'Custom tool',
      input: { type: 'object', properties: {}, required: [] },
      roles: ['worker', 'planner'],
      execute: async () => 'ok',
    });

    registry.register(tool);
    assert.equal(registry.toolsForRole('worker').length, 1);
    assert.equal(registry.toolsForRole('planner').length, 1);
    assert.equal(registry.toolsForRole('reviewer').length, 0);
  });

  it('defaults to all roles when none specified', () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: 'universal',
      description: 'Universal tool',
      input: { type: 'object', properties: {}, required: [] },
      execute: async () => 'ok',
    });

    registry.register(tool);
    assert.equal(registry.toolsForRole('worker').length, 1);
    assert.equal(registry.toolsForRole('communicator').length, 1);
    assert.equal(registry.toolsForRole('reviewer').length, 1);
  });
});
