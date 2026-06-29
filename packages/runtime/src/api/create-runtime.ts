import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig, mergeWithDefinition, type RuntimeConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { createApp } from '../server/app.js';
import { Store } from '../storage/store.js';
import { IdentityStore } from '../storage/identity-store.js';
import { IdentityGitSync } from '../storage/identity-git-sync.js';
import { ToolRegistry } from './tool-registry.js';
import { WorkstreamMemoryService } from '../engine/workstream-memory.js';
import { scanAgentDirectory } from '../discover/discover.js';
import { loadSkillsFromDisk, loadInstructionsFromDisk, loadRolesFromDisk } from '../discover/loader.js';
import { RoleRegistry } from '../engine/role-registry.js';
import { mountChannels } from '../channels/mount.js';
import type { ArtificerRuntime, ArtificerChannel, ArtificerSkill, RuntimeOptions } from './types.js';

export async function createRuntime(
  options: RuntimeOptions,
): Promise<ArtificerRuntime> {
  const { rootDir } = options;

  const syntheticEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options.config?.apiKey) syntheticEnv.LLM_API_KEY = options.config.apiKey;
  if (options.config?.baseURL) syntheticEnv.LLM_BASE_URL = options.config.baseURL;

  // Load artificer.config.json early so its fields seed agentName, models, etc.
  const manifest = scanAgentDirectory(rootDir);
  let fileDefinition: import('./types.js').ArtificerConfig | undefined;
  if (manifest.config) {
    try {
      fileDefinition = JSON.parse(
        fs.readFileSync(manifest.config.path, 'utf-8'),
      ) as import('./types.js').ArtificerConfig;
    } catch { /* ignore — config file is optional */ }
  }

  const baseConfig = fileDefinition
    ? mergeWithDefinition(fileDefinition, syntheticEnv)
    : loadConfig(syntheticEnv);

  // Resolve agentName first so the default execDir reflects any name override.
  const agentName = options.config?.agentName ?? fileDefinition?.name ?? baseConfig.agentName;
  const execDir = options.config?.execDir
    ?? (syntheticEnv.ARTIFICER_EXEC_DIR ? path.resolve(syntheticEnv.ARTIFICER_EXEC_DIR) : null)
    ?? path.join(os.homedir(), '.artificer', agentName);

  const skills: ArtificerSkill[] = loadSkillsFromDisk(manifest.skills);
  const instructions = manifest.instructions
    ? loadInstructionsFromDisk(manifest.instructions.path)
    : null;
  const identityRoles = loadRolesFromDisk(manifest.roles);
  const registry = new RoleRegistry(identityRoles);

  const config: RuntimeConfig = {
    ...baseConfig,
    ...options.config,
    agentName,
    execDir,
    identityDir: rootDir,
    globalInstructions: instructions?.content ?? undefined,
  } as RuntimeConfig;

  const store = new Store(execDir);
  await store.init();
  const identity = config.identity?.autoCommit
    ? new IdentityGitSync(rootDir, config.identity, config.github)
    : new IdentityStore(rootDir);
  await identity.init();

  const tools = new ToolRegistry();

  const channels: ArtificerChannel[] = [];

  const memoryService = new WorkstreamMemoryService(identity, store);
  const engine = new Engine(config, store, memoryService, registry);
  const app = createApp(engine, { identity });

  if (channels.length > 0) {
    mountChannels(app, channels, engine);
  }

  return {
    engine,
    app,
    config,
    identity,
    tools,
    skills,
    instructions: instructions?.content ?? null,
    async start(port?: number) {
      const p = port ?? config.port;
      serve({ fetch: app.fetch, port: p }, (info) => {
        const base = `http://localhost:${info.port}`;
        console.log(`[artificer] ${config.agentName} ready\n`);
        console.log(`  API   ${base}/api`);
        console.log(`  UI    ${base}`);
        console.log(`  SSE   ${base}/events\n`);
        console.log(`  identity  ${rootDir}`);
        console.log(`  exec      ${execDir}`);
      });
    },
  };
}
