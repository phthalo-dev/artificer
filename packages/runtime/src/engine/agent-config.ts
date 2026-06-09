import type { ArchetypeName } from './archetypes.js';
import { getArchetype } from './archetypes.js';
import { BUNDLED_SKILLS_DIR } from './bundled-skills.js';
import type { ModelTier } from './models.js';
import {
  composeSystemPrompt,
  type LoadSkillsResult,
  loadSkills,
  mergeSkillNames,
  type SkillsConfig,
} from './skills.js';

export interface ToolOverrides {
  add?: string[];
  remove?: string[];
}

export interface AgentConfig {
  id: string;
  name: string;
  archetype: ArchetypeName;
  toolOverrides?: ToolOverrides;
  modelTier: ModelTier;
  modelOverride?: string;
  skills?: string[];
  promptExtension?: string;
  maxTurns?: number;
  contextDirectives?: string;
}

export interface ResolvedAgentConfig {
  id: string;
  name: string;
  archetype: ArchetypeName;
  tools: string[];
  modelTier: ModelTier;
  modelOverride?: string;
  skills: string[];
  /** What was loaded for the agent's `skills` list (subset of names that had files). */
  loadedSkills: string[];
  /** Names requested but not found on disk. */
  missingSkills: string[];
  systemPrompt: string;
  maxTurns: number;
  contextDirectives?: string;
}

export function resolveAgentConfig(
  config: AgentConfig,
  agentName: string,
  skillsConfig?: SkillsConfig,
): ResolvedAgentConfig {
  const archetype = getArchetype(config.archetype);
  if (!archetype) {
    throw new Error(`Unknown archetype: ${config.archetype}`);
  }

  const tools = resolveTools(archetype.defaultTools, config.toolOverrides);

  const skillNames = mergeSkillNames(
    archetype.defaultSkills,
    config.skills ?? [],
  );
  const base = archetype.systemPrompt(agentName);
  // Async skills loading is wrapped synchronously in resolveAgentConfig by
  // requiring the caller to await the loadSkills result. This keeps the
  // pipeline explicit and lets the engine log warnings on the way through.
  // (See `resolveAgentConfigAsync` for the async variant.)
  const systemPrompt = composeSystemPrompt(
    base,
    config.promptExtension,
    EMPTY_SKILLS_RESULT,
  );

  return {
    id: config.id,
    name: config.name,
    archetype: config.archetype,
    tools,
    modelTier: config.modelTier,
    modelOverride: config.modelOverride,
    skills: skillNames,
    loadedSkills: [],
    missingSkills: skillNames,
    systemPrompt,
    maxTurns: config.maxTurns ?? 24,
    contextDirectives: config.contextDirectives,
  };
}

const EMPTY_SKILLS_RESULT: LoadSkillsResult = {
  content: '',
  loaded: [],
  missing: [],
  truncated: false,
};

/**
 * Async variant that actually loads skill files from disk. Use this in
 * production paths; the sync `resolveAgentConfig` exists for tests and
 * hot loops that need to be deterministic and skip skill composition.
 */
export async function resolveAgentConfigAsync(
  config: AgentConfig,
  agentName: string,
  skillsConfig: SkillsConfig,
): Promise<ResolvedAgentConfig> {
  const archetype = getArchetype(config.archetype);
  if (!archetype) {
    throw new Error(`Unknown archetype: ${config.archetype}`);
  }

  const tools = resolveTools(archetype.defaultTools, config.toolOverrides);
  const skillNames = mergeSkillNames(
    archetype.defaultSkills,
    config.skills ?? [],
  );
  const skills = await loadSkills(skillNames, skillsConfigForAgent(skillsConfig));
  const systemPrompt = composeSystemPrompt(
    archetype.systemPrompt(agentName),
    config.promptExtension,
    skills,
  );

  return {
    id: config.id,
    name: config.name,
    archetype: config.archetype,
    tools,
    modelTier: config.modelTier,
    modelOverride: config.modelOverride,
    skills: skillNames,
    loadedSkills: skills.loaded,
    missingSkills: skills.missing,
    systemPrompt,
    maxTurns: config.maxTurns ?? 24,
    contextDirectives: config.contextDirectives,
  };
}

/** External skill dir overrides bundled skills when names collide. */
function skillsConfigForAgent(config: SkillsConfig): SkillsConfig {
  const dirs: string[] = [];
  if (config.enabled && config.dir) dirs.push(config.dir);
  if (!dirs.includes(BUNDLED_SKILLS_DIR)) dirs.push(BUNDLED_SKILLS_DIR);
  return {
    enabled: true,
    dir: dirs[0] ?? BUNDLED_SKILLS_DIR,
    additionalDirs: dirs.slice(1),
    maxTotalChars: config.maxTotalChars,
  };
}

function resolveTools(
  defaults: string[],
  overrides?: ToolOverrides,
): string[] {
  if (!overrides) return defaults;

  let tools = [...defaults];

  if (overrides.remove && overrides.remove.length > 0) {
    const removeSet = new Set(overrides.remove);
    tools = tools.filter((t) => !removeSet.has(t));
  }

  if (overrides.add && overrides.add.length > 0) {
    const existingSet = new Set(tools);
    for (const tool of overrides.add) {
      if (!existingSet.has(tool)) {
        tools.push(tool);
      }
    }
  }

  return tools;
}

export function createAgentConfig(
  params: Omit<AgentConfig, 'id'> & { id?: string },
): AgentConfig {
  const id = params.id ?? `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    ...params,
  };
}
