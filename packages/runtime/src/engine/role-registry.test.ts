import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { RoleRegistry } from './role-registry.js';
import type { IdentityRole } from '../discover/loader.js';

describe('RoleRegistry', () => {
  it('contains all 6 built-in roles with no identity roles', () => {
    const registry = new RoleRegistry();
    for (const name of [
      'communicator',
      'orchestrator',
      'planner',
      'worker',
      'reviewer',
      'librarian',
    ]) {
      assert.ok(registry.getRole(name), `missing built-in role: ${name}`);
    }
  });

  it('built-in role system prompt includes agentName substitution', () => {
    const registry = new RoleRegistry();
    const worker = registry.getRole('worker')!;
    const prompt = worker.system('TestBot');
    assert.ok(
      prompt.includes('TestBot'),
      'system prompt should include agent name',
    );
  });

  it('identity role overrides a built-in by slug', () => {
    const ir: IdentityRole = {
      slug: 'worker',
      name: 'Custom Worker',
      blurb: 'Does custom work.',
      baseRole: 'worker',
      systemTemplate: 'You are {{agentName}} custom worker.',
    };
    const registry = new RoleRegistry([ir]);
    const worker = registry.getRole('worker')!;
    assert.equal(worker.name, 'Custom Worker');
    assert.equal(worker.blurb, 'Does custom work.');
    assert.equal(worker.system('Hal'), 'You are Hal custom worker.');
  });

  it('identity role adds a new slug not in built-ins', () => {
    const ir: IdentityRole = {
      slug: 'security-auditor',
      name: 'Security Auditor',
      blurb: 'Finds bugs.',
      baseRole: 'reviewer',
      systemTemplate: 'You are {{agentName}} auditor.',
    };
    const registry = new RoleRegistry([ir]);
    const auditor = registry.getRole('security-auditor')!;
    assert.ok(auditor, 'custom role should be registered');
    assert.equal(auditor.baseRole, 'reviewer');
    assert.equal(auditor.system('Hal'), 'You are Hal auditor.');
  });

  it('new role has correct baseRole from identity', () => {
    const ir: IdentityRole = {
      slug: 'analyst',
      name: 'Analyst',
      blurb: '',
      baseRole: 'planner',
      systemTemplate: 'Analyse.',
    };
    const registry = new RoleRegistry([ir]);
    assert.equal(registry.getRole('analyst')!.baseRole, 'planner');
  });

  it('getRole returns undefined for unknown names', () => {
    const registry = new RoleRegistry();
    assert.equal(registry.getRole('nonexistent'), undefined);
  });

  it('listRoleNames includes all built-ins', () => {
    const registry = new RoleRegistry();
    const names = registry.listRoleNames();
    for (const n of [
      'communicator',
      'orchestrator',
      'planner',
      'worker',
      'reviewer',
      'librarian',
    ]) {
      assert.ok(names.includes(n), `${n} missing from listRoleNames`);
    }
  });

  it('listRoleNames includes custom roles', () => {
    const ir: IdentityRole = {
      slug: 'security-auditor',
      name: 'Security Auditor',
      blurb: '',
      baseRole: 'reviewer',
      systemTemplate: '',
    };
    const registry = new RoleRegistry([ir]);
    assert.ok(registry.listRoleNames().includes('security-auditor'));
  });
});
