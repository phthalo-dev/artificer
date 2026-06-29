import type { IdentityRole } from '../discover/loader.js';
import type { RoleDefinition } from './roles.js';
import { getRole as getBuiltinRole } from './roles.js';

const BUILT_IN_NAMES = [
  'communicator',
  'orchestrator',
  'planner',
  'worker',
  'reviewer',
  'librarian',
] as const;

export class RoleRegistry {
  private readonly roles = new Map<string, RoleDefinition>();

  constructor(identityRoles: IdentityRole[] = []) {
    for (const name of BUILT_IN_NAMES) {
      this.roles.set(name, getBuiltinRole(name));
    }
    for (const ir of identityRoles) {
      const template = ir.systemTemplate;
      this.roles.set(ir.slug, {
        name: ir.name,
        blurb: ir.blurb,
        baseRole: ir.baseRole,
        system: (agentName: string) =>
          template.replace(/\{\{agentName\}\}/g, agentName),
      });
    }
  }

  getRole(name: string): RoleDefinition | undefined {
    return this.roles.get(name);
  }

  listRoleNames(): string[] {
    return [...this.roles.keys()];
  }
}
