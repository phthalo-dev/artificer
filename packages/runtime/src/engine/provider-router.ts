import type { RuntimeConfig } from '../config.js';
import type { ExecutorConfig } from '../api/types.js';
import type { ModelTier } from './models.js';
import type { QuotaLedger } from './quota-ledger.js';
import { resolveFailoverApiKey } from './quota-config.js';
import type { DispatchRoute, ExecutionRouteConfig } from './quota-types.js';
import type { RoleName } from '../storage/types.js';
import type { WorkerExecutor } from './executor.js';
import { CursorAgentExecutor } from './cursor-executor.js';
import { ClaudeCodeExecutor } from './claude-code-executor.js';
import { modelsForRoute, roleTiersForRoute } from './route-config.js';

export interface ResolveRouteInput {
  role: string;
  workstreamId?: string;
  tier: ModelTier;
}

export class ProviderRouter {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly ledger: QuotaLedger,
    private readonly routes: ExecutionRouteConfig[],
    private readonly env: NodeJS.ProcessEnv,
    private readonly buildExecutor: (
      executor?: ExecutorConfig,
    ) => WorkerExecutor | undefined,
  ) {}

  getPrimaryAccountId(): string {
    return this.routes[0]?.accountId ?? 'primary';
  }

  resolve(input: ResolveRouteInput): DispatchRoute | null {
    const { role, workstreamId, tier } = input;

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i]!;
      if (route.roles && !route.roles.includes(role)) continue;

      const estimate = this.ledger.estimateNextRun(
        tier,
        role,
        route.accountId,
      );
      const useReserve = role === 'communicator' && i === 0;
      if (
        !this.ledger.canDispatch(
          route.accountId,
          estimate,
          role,
          workstreamId,
          { useReserve },
        )
      ) {
        continue;
      }
      if (this.ledger.isAccountExhausted(route.accountId, workstreamId)) {
        continue;
      }

      if (i === 0) {
        const primaryAccountId = this.routes[0]!.accountId;
        if (this.ledger.getActiveRoute(primaryAccountId) !== 'primary') {
          this.ledger.clearActiveRoute(primaryAccountId);
        }
      } else {
        const primaryAccountId = this.routes[0]!.accountId;
        this.ledger.setActiveRoute(primaryAccountId, route.id);
      }

      return this.dispatchRoute(route);
    }

    return null;
  }

  private dispatchRoute(route: ExecutionRouteConfig): DispatchRoute {
    const models = modelsForRoute(route, this.config.models);
    const roleTiers = roleTiersForRoute(route, this.config.roleTiers);
    const executorConfig =
      route.execution === 'llm' ? undefined : route.execution;
    const executor = this.buildExecutor(executorConfig);
    const useLlm = route.execution === 'llm' || (!executor && !executorConfig);

    return {
      profileId: route.id,
      accountId: route.accountId,
      baseURL: route.llm?.baseURL ?? this.config.baseURL,
      apiKey: resolveFailoverApiKey(this.env, route.llm?.apiKeyEnv),
      models,
      roleTiers,
      executorName: useLlm ? undefined : executor?.name,
      useLlmForWorkRoles: useLlm,
    };
  }
}

export function executorForRoute(
  route: DispatchRoute,
  buildExecutor: (executor?: ExecutorConfig) => WorkerExecutor | undefined,
  globalExecutor?: WorkerExecutor,
): WorkerExecutor | undefined {
  if (route.useLlmForWorkRoles) return undefined;
  if (route.profileId === 'primary') return globalExecutor;
  if (route.executorName === 'cursor-agent') return new CursorAgentExecutor();
  if (route.executorName === 'claude-code') return new ClaudeCodeExecutor();
  return globalExecutor;
}
