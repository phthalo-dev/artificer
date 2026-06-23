import type { ToolContext } from '../context.js';
import type { ModelTier, ModelTiers } from '../engine/models.js';
import type { JsonSchema, ToolDef } from '../llm/types.js';
import type { RoleName } from '../storage/types.js';

export interface IdentityConfig {
  autoCommit?: boolean;
  autoPush?: boolean;
  commitPrefix?: string;
}

export interface GitHubShorthand {
  watchInterval?: string;
}

export interface ArtificerConfig {
  name: string;
  description?: string;
  preset?: string;
  models?: Partial<ModelTiers>;
  roleTiers?: Partial<Record<RoleName, ModelTier>>;
  github?: GitHubShorthand;
  concurrency?: number;
  maxIterationsPerCall?: number;
  port?: number;
  dataDir?: string;
  identity?: IdentityConfig;
}

export interface ToolDefinition<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  input: JsonSchema;
  roles?: RoleName[];
  needsApproval?: boolean | ((input: TInput) => boolean);
  execute: (input: TInput, ctx: ToolContext) => Promise<string> | string;
}

export interface ArtificerTool<TInput = Record<string, unknown>> {
  readonly name: string;
  readonly definition: ToolDefinition<TInput>;
  toToolDef(ctx: ToolContext): ToolDef;
}
