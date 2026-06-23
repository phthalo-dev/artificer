import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig, type RuntimeConfig } from '../config.js';
import { Engine } from '../engine/engine.js';
import { createApp } from '../server/app.js';
import { Store } from '../storage/store.js';
import { IdentityStore } from '../storage/identity-store.js';
import { ToolRegistry } from './tool-registry.js';
import { scanAgentDirectory } from '../discover/discover.js';
import { loadSkillsFromDisk, loadInstructionsFromDisk } from '../discover/loader.js';
import type { ArtificerRuntime, ArtificerSkill, RuntimeOptions } from './types.js';

export async function createRuntime(
  options: RuntimeOptions,
): Promise<ArtificerRuntime> {
  const { rootDir } = options;

  const syntheticEnv: NodeJS.ProcessEnv = { ...process.env };
  if (options.config?.apiKey) syntheticEnv.LLM_API_KEY = options.config.apiKey;
  if (options.config?.baseURL) syntheticEnv.LLM_BASE_URL = options.config.baseURL;

  const envConfig = loadConfig(syntheticEnv);
  const dataDir = options.config?.dataDir ?? path.join(rootDir, '.artificer');

  const config: RuntimeConfig = {
    ...envConfig,
    ...options.config,
    dataDir,
    identityDir: rootDir,
  } as RuntimeConfig;

  const manifest = scanAgentDirectory(rootDir);

  const skills: ArtificerSkill[] = loadSkillsFromDisk(manifest.skills);
  const instructions = manifest.instructions
    ? loadInstructionsFromDisk(manifest.instructions.path)
    : null;

  const store = new Store(dataDir);
  await store.init();
  const identity = new IdentityStore(rootDir);
  await identity.init();

  const tools = new ToolRegistry();

  const engine = new Engine(config, store);
  const app = createApp(engine);

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
        console.log(
          `[artificer] ${config.agentName} listening on http://localhost:${info.port}`,
        );
        console.log(`[artificer] identity: ${rootDir}`);
        console.log(`[artificer] execution: ${dataDir}`);
      });
    },
  };
}
