import type { RuntimeConfig } from './config.js';
import type { ModelTier } from './engine/models.js';
import type {
  ProviderConfigSnapshot,
  ProviderConfigUpdate,
} from './engine/provider-config.js';
import type { ScheduleAction, ScheduleDefinition } from './engine/schedules.js';
import type { Store } from './storage/store.js';
import type { IdentityStore } from './storage/identity-store.js';
import type {
  RunRecord,
  ToolInvocation,
  Workstream,
} from './storage/types.js';

export interface SpawnCallInput {
  role: string;
  description: string;
  workstreamId?: string;
  parentRunId?: string;
  /** The inbound message this work ultimately traces back to. */
  originMessageId?: string;
  /** Optional complexity override choosing the model tier for this call. */
  complexity?: ModelTier;
}

export type RuntimeEvent =
  | { kind: 'message'; at: string; data: unknown }
  | { kind: 'workstream'; at: string; data: unknown }
  | { kind: 'run'; at: string; data: unknown }
  | { kind: 'tool'; at: string; data: ToolInvocation & { runId: string } }
  | { kind: 'quota'; at: string; data: unknown };

/**
 * The surface the engine exposes to tools. Tools use this to spawn child
 * calls, start workstreams, reply to the user, and read/update state — which
 * is how the "orchestrator as a tool" recursion works.
 */
export interface EngineApi {
  readonly store: Store;
  readonly identity?: IdentityStore;
  readonly config: RuntimeConfig;
  spawnCall(input: SpawnCallInput): Promise<{ runId: string; taskId?: string }>;
  startWorkstream(input: {
    title: string;
    goal: string;
    repoUrl?: string;
    baseCommit?: string;
    parentRunId?: string;
    originMessageId?: string;
  }): Promise<Workstream>;
  reply(content: string, workstreamId?: string): Promise<void>;
  emit(event: RuntimeEvent): void;
  listRoles(): string[];
  getProviderConfig(): ProviderConfigSnapshot;
  updateProviderConfig(update: ProviderConfigUpdate): Promise<string>;
  listSchedules(): Array<
    ScheduleDefinition & { lastFiredAt: number | null; inFlight: boolean }
  >;
  upsertSchedule(input: {
    id: string;
    name?: string;
    every?: string;
    cron?: string;
    timezone?: string;
    action: ScheduleAction;
    enabled?: boolean;
    body: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  setScheduleEnabled(
    id: string,
    enabled: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  deleteSchedule(id: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Everything a tool factory needs about the call it is serving. */
export interface ToolContext {
  engine: EngineApi;
  run: RunRecord;
  /** Workspace directory scoped to this run's workstream (or a shared root). */
  workspaceDir: string;
}
