import type { ToolRegistry } from '../api/tool-registry.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import {
  emptyDeferredCatalog,
  type DeferredToolCatalog,
} from './deferred-catalog.js';
import { toolsForRole } from './registry.js';

export type ToolPlan = {
  role: string;
  alwaysOn: readonly ToolDef[];
  alwaysOnNames: readonly string[];
  deferred: DeferredToolCatalog;
};

export function createToolPlan(args: {
  role: string;
  ctx: ToolContext;
  customRegistry?: ToolRegistry;
}): ToolPlan {
  const tools = toolsForRole(args.role, args.ctx, args.customRegistry);
  const alwaysOn = Object.freeze([...tools]) as readonly ToolDef[];
  if (alwaysOn.length > 40) {
    console.warn(
      `[artificer] tool plan for role "${args.role}" has ${alwaysOn.length} always-on tools (>40); consider deferred discovery`,
    );
  }
  return {
    role: args.role,
    alwaysOn,
    alwaysOnNames: Object.freeze(alwaysOn.map((t) => t.name)),
    deferred: emptyDeferredCatalog(),
  };
}
