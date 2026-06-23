import type { ModelTier, ModelTiers } from '../engine/models.js';
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
