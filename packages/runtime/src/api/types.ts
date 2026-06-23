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

export interface ChannelMessage {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutput {
  content: string;
  workstreamId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelDefinition {
  name: string;
  description: string;
  verify?: (headers: Record<string, string>, body: string) => Promise<boolean> | boolean;
  receive: (payload: Record<string, unknown>) => Promise<ChannelMessage>;
  format: (output: ChannelOutput) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface ArtificerChannel {
  readonly name: string;
  readonly definition: ChannelDefinition;
  receive(payload: Record<string, unknown>): Promise<ChannelMessage>;
  format(output: ChannelOutput): Promise<Record<string, unknown>>;
}

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
}

export interface ArtificerSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}
