import type { RoleName } from '../storage/types.js';
import type { ArtificerTool } from './types.js';

const ALL_ROLES: RoleName[] = [
  'communicator', 'orchestrator', 'planner', 'reviewer', 'worker', 'librarian',
];

export class ToolRegistry {
  private readonly custom = new Map<RoleName, ArtificerTool[]>();

  register(tool: ArtificerTool): void {
    const roles = tool.definition.roles ?? ALL_ROLES;
    for (const role of roles) {
      const list = this.custom.get(role) ?? [];
      list.push(tool);
      this.custom.set(role, list);
    }
  }

  toolsForRole(role: RoleName): ArtificerTool[] {
    return this.custom.get(role) ?? [];
  }
}
