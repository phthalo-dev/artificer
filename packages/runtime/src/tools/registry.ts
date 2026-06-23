import type { ToolRegistry } from '../api/tool-registry.js';
import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import type { RoleName } from '../storage/types.js';
import { createArtifactTools } from './artifacts.js';
import {
  createCommunicatorTools,
  createReplyTool,
} from './communication.js';
import { createEditTool } from './edit.js';
import { createFetchTools } from './fetch.js';
import { createFileTools } from './files.js';
import { createGitTools } from './git.js';
import { createOrchestratorTools } from './orchestrator-tool.js';
import { createSearchTools } from './search.js';
import { createShellTool } from './shell.js';
import { createToolResultReadTools } from './tool-result-read.js';

function byName(tools: ToolDef[], names: string[]): ToolDef[] {
  const set = new Set(names);
  return tools.filter((t) => set.has(t.name));
}

/**
 * Returns the tools available to a given role for a specific call. The
 * orchestrator tool (get_status / invoke_call / update_status / memories) is
 * shared widely so any level can query the system and spawn new calls.
 */
export function toolsForRole(
  role: RoleName,
  ctx: ToolContext,
  customRegistry?: ToolRegistry,
): ToolDef[] {
  const orchestrator = createOrchestratorTools(ctx);
  const reply = createReplyTool(ctx);
  const communicator = createCommunicatorTools(ctx);
  const files = createFileTools(ctx);
  const edit = createEditTool(ctx);
  const shell = createShellTool(ctx);
  const git = createGitTools(ctx);
  const artifacts = createArtifactTools(ctx);
  const fetchTools = createFetchTools(ctx);
  const toolResultRead = createToolResultReadTools(ctx);
  const searchAll = createSearchTools(ctx);
  const searchGrepOnly = createSearchTools(ctx, { includeGlob: false });

  let result: ToolDef[];
  switch (role) {
    case 'communicator':
      result = [
        ...reply,
        ...communicator,
        ...byName(orchestrator, ['get_status', 'query_memories', 'add_memory']),
      ];
      break;

    case 'orchestrator':
      result = [
        ...orchestrator,
        ...reply,
        ...searchGrepOnly,
        ...toolResultRead,
        ...byName(artifacts, ['read_plan']),
        ...byName(files, ['read_file', 'list_files']),
      ];
      break;

    case 'planner':
      result = [
        ...files,
        ...edit,
        ...searchAll,
        ...toolResultRead,
        ...shell,
        ...git,
        ...byName(artifacts, ['write_plan', 'read_plan']),
        ...byName(orchestrator, [
          'get_status',
          'query_memories',
          'add_memory',
          'record_finding',
        ]),
      ];
      break;

    case 'reviewer':
      result = [
        ...byName(files, ['read_file', 'list_files']),
        ...searchAll,
        ...toolResultRead,
        ...shell,
        ...git,
        ...byName(artifacts, ['read_plan', 'submit_review']),
        ...byName(orchestrator, ['get_status', 'query_memories', 'record_finding']),
      ];
      break;

    case 'worker':
      result = [
        ...files,
        ...edit,
        ...searchAll,
        ...toolResultRead,
        ...shell,
        ...git,
        ...byName(artifacts, ['read_plan', 'report_status']),
        ...byName(orchestrator, [
          'get_status',
          'query_memories',
          'add_memory',
          'record_finding',
        ]),
      ];
      break;

    case 'librarian':
      result = [
        ...fetchTools,
        ...reply,
        ...byName(orchestrator, ['query_memories', 'add_memory']),
      ];
      break;

    default:
      result = [];
  }

  if (customRegistry) {
    const custom = customRegistry.toolsForRole(role).map((t) => t.toToolDef(ctx));
    result.push(...custom);
  }
  return result;
}
