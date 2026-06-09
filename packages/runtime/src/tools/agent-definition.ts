import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { ArchetypeName } from '../engine/archetypes.js';
import { listArchetypes } from '../engine/archetypes.js';
import type { AgentConfig, ToolOverrides } from '../engine/agent-config.js';
import { createAgentConfig } from '../engine/agent-config.js';
import { isModelTier } from '../engine/models.js';
import type { ModelTier } from '../engine/models.js';
import type { PhaseAgentDefinition, StoredAgentConfig } from '../storage/types.js';
import type { Store } from '../storage/store.js';

const agentRegistry = new Map<string, AgentConfig>();

export function getAgentConfig(id: string): AgentConfig | undefined {
  return agentRegistry.get(id);
}

/** Resolve an agent config from the in-memory registry or persisted phase storage. */
export async function getAgentConfigForWorkstream(
  store: Store,
  workstreamId: string,
  id: string,
): Promise<AgentConfig | undefined> {
  const cached = agentRegistry.get(id);
  if (cached) return cached;

  const ws = await store.getWorkstream(workstreamId);
  const stored = ws?.phaseConfig?.agentConfigs?.[id];
  if (!stored) return undefined;

  const config = stored as AgentConfig;
  agentRegistry.set(id, config);
  return config;
}

function toStoredAgentConfig(config: AgentConfig): StoredAgentConfig {
  return {
    id: config.id,
    name: config.name,
    archetype: config.archetype,
    toolOverrides: config.toolOverrides,
    modelTier: config.modelTier,
    modelOverride: config.modelOverride,
    skills: config.skills,
    promptExtension: config.promptExtension,
    maxTurns: config.maxTurns,
    contextDirectives: config.contextDirectives,
  };
}

export function setAgentConfig(id: string, config: AgentConfig): void {
  agentRegistry.set(id, config);
}

export function clearAgentRegistry(): void {
  agentRegistry.clear();
}

export function createAgentDefinitionTools(ctx: ToolContext): ToolDef[] {
  const { engine, run } = ctx;
  const { store } = engine;

  return [
    {
      name: 'define_agent',
      description:
        'Define a custom agent configuration based on an archetype with optional customizations. ' +
        'Returns an agent ID that can be used with spawn_agent or plan_agents. Use this to create specialized agents ' +
        'with specific tool sets, model tiers, or prompt extensions.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Human-readable name for this agent (e.g., "api-integration-coder").',
          },
          archetype: {
            type: 'string',
            enum: listArchetypes(),
            description:
              'Base archetype to build from (planner, coder, reviewer, researcher, debugger, ' +
              'design-planner, designer, design-reviewer).',
          },
          toolOverrides: {
            type: 'object',
            properties: {
              add: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tools to add beyond the archetype defaults.',
              },
              remove: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tools to remove from the archetype defaults.',
              },
            },
            description: 'Optional tool customizations.',
          },
          modelTier: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Model tier for this agent. Defaults to archetype default.',
          },
          skills: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional skill names to compose into the system prompt.',
          },
          promptExtension: {
            type: 'string',
            description: 'Additional instructions appended to the archetype system prompt.',
          },
          maxTurns: {
            type: 'number',
            description: 'Maximum tool-use iterations for this agent. Defaults to 24.',
          },
          contextDirectives: {
            type: 'string',
            description: 'Additional context instructions for the agent.',
          },
        },
        required: ['name', 'archetype'],
      },
      handler: async (input) => {
        const name = String(input.name);
        const archetype = String(input.archetype) as ArchetypeName;

        if (!listArchetypes().includes(archetype)) {
          return `Error: archetype must be one of ${listArchetypes().join(', ')}.`;
        }

        const toolOverrides: ToolOverrides | undefined = input.toolOverrides
          ? {
              add: Array.isArray((input.toolOverrides as { add?: unknown[] }).add)
                ? ((input.toolOverrides as { add?: unknown[] }).add as unknown[]).map(String)
                : undefined,
              remove: Array.isArray((input.toolOverrides as { remove?: unknown[] }).remove)
                ? ((input.toolOverrides as { remove?: unknown[] }).remove as unknown[]).map(String)
                : undefined,
            }
          : undefined;

        const modelTier = isModelTier(input.modelTier)
          ? (input.modelTier as ModelTier)
          : undefined;

        const skills = Array.isArray(input.skills)
          ? (input.skills as unknown[]).map(String)
          : undefined;

        const config = createAgentConfig({
          name,
          archetype,
          toolOverrides,
          modelTier: modelTier ?? 'medium',
          skills,
          promptExtension: input.promptExtension
            ? String(input.promptExtension)
            : undefined,
          maxTurns: typeof input.maxTurns === 'number' ? input.maxTurns : undefined,
          contextDirectives: input.contextDirectives
            ? String(input.contextDirectives)
            : undefined,
        });

        agentRegistry.set(config.id, config);

        return `Defined agent "${name}" with ID ${config.id} (archetype: ${archetype}, tier: ${config.modelTier}).`;
      },
    },
    {
      name: 'plan_agents',
      description:
        'Assign previously defined agents to roles for the current phase. ' +
        'The state machine will use these agents instead of defaults when dispatching work. ' +
        'Call this after define_agent to configure the phase before execution begins.',
      inputSchema: {
        type: 'object',
        properties: {
          agents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: {
                  type: 'string',
                  enum: ['planner', 'worker', 'reviewer'],
                  description: 'The role this agent will fill.',
                },
                agentId: {
                  type: 'string',
                  description: 'ID of a previously defined agent.',
                },
              },
              required: ['role', 'agentId'],
            },
            description: 'Agent assignments for this phase.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream to configure. Defaults to the current workstream.',
          },
        },
        required: ['agents'],
      },
      handler: async (input) => {
        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;
        if (!workstreamId) return 'Error: no workstream to configure.';

        const agentsInput = input.agents as Array<{ role: string; agentId: string }>;
        const definitions: PhaseAgentDefinition[] = [];
        const configsToPersist: StoredAgentConfig[] = [];

        for (const entry of agentsInput) {
          const agentId = String(entry.agentId);
          const config = agentRegistry.get(agentId);
          if (!config) {
            return `Error: agent ${agentId} not found. Use define_agent first.`;
          }
          definitions.push({
            id: `${entry.role}_${agentId}`,
            role: entry.role as 'planner' | 'worker' | 'reviewer',
            agentConfigId: agentId,
          });
          configsToPersist.push(toStoredAgentConfig(config));
        }

        const ws = await store.updatePhaseAgents(
          workstreamId,
          definitions,
          configsToPersist,
        );
        if (!ws) return `Error: workstream ${workstreamId} not found or has no phase config.`;

        const summary = definitions
          .map((d) => `${d.role}=${d.agentConfigId}`)
          .join(', ');
        return `Phase agents configured for ${workstreamId}: ${summary}`;
      },
    },
    {
      name: 'spawn_agent',
      description:
        'Spawn an instance of a previously defined agent to perform a task. ' +
        'The agent runs asynchronously; the state machine dispatches the next action when it finishes.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'ID of the agent to spawn (from define_agent).',
          },
          task: {
            type: 'string',
            description: 'The task for the agent to perform.',
          },
          workstreamId: {
            type: 'string',
            description: 'Workstream the agent belongs to. Defaults to the current workstream.',
          },
        },
        required: ['agentId', 'task'],
      },
      handler: async (input) => {
        const agentId = String(input.agentId);
        const config = agentRegistry.get(agentId);

        if (!config) {
          return `Error: agent ${agentId} not found. Use define_agent first.`;
        }

        const workstreamId =
          (input.workstreamId as string | undefined) ?? run.workstreamId;

        const result = await engine.spawnCall({
          role: 'worker',
          description: String(input.task),
          workstreamId,
          parentRunId: run.id,
          originMessageId: run.originMessageId,
          complexity: config.modelTier,
          agentConfig: config,
        });

        return `Spawned agent "${config.name}" (${result.runId})${
          result.taskId ? ` (task ${result.taskId})` : ''
        }. It will run asynchronously.`;
      },
    },
  ];
}
