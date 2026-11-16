import type { Hono } from 'hono';
import type { RuntimeConfig } from '../config.js';
import type { ToolContext } from '../context.js';
import type { Engine } from '../engine/engine.js';
import type { ModelTier, ModelTiers } from '../engine/models.js';
import type { QuotaConfig } from '../engine/quota-types.js';
import type { JsonSchema, ToolDef } from '../llm/types.js';
import type { IdentityStore } from '../storage/identity-store.js';
import type { RoleName } from '../storage/types.js';
import type { ToolRegistry } from './tool-registry.js';

export interface IdentityConfig {
  autoCommit?: boolean;
  autoPush?: boolean;
  commitPrefix?: string;
  /** Git remote name to push to (default: "origin"). */
  remote?: string;
  /** Branch to push to (default: current branch). */
  branch?: string;
  /** How often to pull identity from origin. Duration string e.g. "5m". Absent disables. */
  pullInterval?: string;
  /**
   * When true (default), spawn a librarian distill after a workstream finishes
   * to extract claim/entity memories from the chronicle. Set false to disable.
   */
  distillWorkstreams?: boolean;
  /** Optional embedding-backed hybrid ranking (off by default). */
  embeddings?: {
    enabled?: boolean;
    provider?: 'openai' | 'local' | 'none';
    model?: string;
  };
}

export interface ResolvedIdentityConfig extends IdentityConfig {
  pullIntervalMs?: number;
}

export interface GitHubShorthand {
  watchInterval?: string;
}

export type ExecutorConfig =
  | 'llm'
  | 'cursor-agent'
  | 'claude-code'
  | 'opencode'
  | { type: 'cursor-agent'; model?: string }
  | { type: 'claude-code'; model?: string }
  | { type: 'opencode'; model?: string }
  | {
      type: 'cli';
      command: string;
      args: string[];
      promptMode: 'stdin' | 'arg';
      model?: string;
      timeout?: number;
      mcpConfigPath?: string;
    }
  | AcpExecutorConfig;

export type AcpPresetId = 'opencode';

export interface AcpExecutorConfig {
  type: 'acp';
  agent?: AcpPresetId;
  command?: string;
  args?: string[];
  model?: string;
  env?: Record<string, string>;
  mode?: string;
  resumes?: boolean;
  timeout?: number;
}

export interface WorkspaceServicesConfig {
  disabled?: string[];
  overrides?: Record<string, { portRange?: [number, number] }>;
}

export interface RepoConfig {
  id: string;
  url: string;
  baseBranch: string;
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
  execDir?: string;
  identity?: IdentityConfig;
  executor?: ExecutorConfig;
  quota?: QuotaConfig;
  workspaceServices?: WorkspaceServicesConfig;
  repos?: RepoConfig[];
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
  verify?: (
    headers: Record<string, string>,
    body: string,
  ) => Promise<boolean> | boolean;
  receive: (payload: Record<string, unknown>) => Promise<ChannelMessage>;
  format: (
    output: ChannelOutput,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
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

export interface ConnectionAuth {
  type: 'bearer' | 'basic' | 'header';
  envVar: string;
  name?: string;
}

export interface ConnectionDefinition {
  type: 'mcp' | 'openapi';
  name: string;
  description: string;
  url: string;
  specUrl?: string;
  auth?: ConnectionAuth;
  operations?: { allow: string[] } | { block: string[] };
  roles?: RoleName[];
}

export interface ArtificerConnection {
  readonly name: string;
  readonly definition: ConnectionDefinition;
}

export interface RuntimeOptions {
  rootDir: string;
  config?: Partial<RuntimeConfig>;
}

export interface ArtificerRuntime {
  readonly engine: Engine;
  readonly app: Hono;
  readonly config: RuntimeConfig;
  readonly identity: IdentityStore;
  readonly tools: ToolRegistry;
  readonly skills: ArtificerSkill[];
  readonly instructions: string | null;
  start(port?: number): Promise<void>;
}
