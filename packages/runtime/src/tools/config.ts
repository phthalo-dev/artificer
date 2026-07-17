import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { ProviderConfigUpdate } from '../engine/provider-config.js';
import type { ExecutionRouteConfig } from '../engine/quota-types.js';

/** Tools for reading and updating provider routes, quotas, and model presets. */
export function createProviderConfigTools(ctx: ToolContext): ToolDef[] {
  const { engine } = ctx;

  return [
    {
      name: 'get_provider_config',
      description:
        "Read the agent's current provider configuration: model preset, tier models, ordered execution routes (LLM/agent + quotas), and live quota usage. Call this before changing routes or budgets.",
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const snapshot = engine.getProviderConfig();
        return JSON.stringify(snapshot, null, 2);
      },
    },
    {
      name: 'update_provider_config',
      description:
        'Update how the agent runs: switch model preset, change daily budget, adjust communicator reserve %, or replace the full ordered route/failover chain. Changes apply to subsequent runs and are saved to artificer.config.json. Always call get_provider_config first when editing routes.',
      inputSchema: {
        type: 'object',
        properties: {
          applyPreset: {
            type: 'string',
            description:
              'Named model preset id (e.g. async-economy, go-economy). Updates primary route models when routes exist.',
          },
          reservePercent: {
            type: 'number',
            description:
              'Percent of each quota window held back for communicator replies near the limit (0–50).',
          },
          dailyBudgetLimit: {
            type: 'number',
            description:
              'Daily dollar cap for the primary route (updates or adds the daily-budget window).',
          },
          routes: {
            type: 'array',
            description:
              'Full ordered execution route chain to replace the current one. Each route needs id, accountId, mode, execution (llm|cursor-agent|claude-code), models {low,medium,high}, windows[], and llm.baseURL when execution is llm.',
            items: { type: 'object' },
          },
        },
      },
      handler: async (input) => {
        const update: ProviderConfigUpdate = {};
        if (input.applyPreset !== undefined) {
          update.applyPreset = String(input.applyPreset);
        }
        if (input.reservePercent !== undefined) {
          update.reservePercent = Number(input.reservePercent);
        }
        if (input.dailyBudgetLimit !== undefined) {
          update.dailyBudgetLimit = Number(input.dailyBudgetLimit);
        }
        if (input.routes !== undefined) {
          update.routes = input.routes as ExecutionRouteConfig[];
        }
        try {
          const summary = await engine.updateProviderConfig(update);
          return `Configuration updated: ${summary}`;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error: ${message}`;
        }
      },
    },
  ];
}
