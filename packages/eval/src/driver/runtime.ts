import childProcess, { type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import {
  DEFAULT_PRESET_ID,
  getPreset,
  type ModelPreset,
} from '@artificer-ai/runtime';
import { RuntimeClient } from './client.js';

export interface EvalRuntimeOptions {
  identityDir: string;
  execDir: string;
  presetId?: string;
  models?: Partial<ModelPreset['tiers']>;
  port?: number;
}

export interface EvalRuntimeHandle {
  client: RuntimeClient;
  execDir: string;
  identityDir: string;
  stop: () => Promise<void>;
}

const require = createRequire(import.meta.url);
const runtimeRoot = path.dirname(
  require.resolve('@artificer-ai/runtime/package.json'),
);
const runtimeEntry = path.join(runtimeRoot, 'dist', 'index.js');
const runtimeSourceEntry = path.join(runtimeRoot, 'src', 'index.ts');

async function runtimeArgs(): Promise<string[]> {
  try {
    await fs.access(runtimeEntry);
    return [runtimeEntry];
  } catch {
    return ['--import', 'tsx', runtimeSourceEntry];
  }
}

function getAvailablePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = (port: number) => {
      const server = net.createServer();
      server.unref();
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && port !== 0) {
          probe(0);
          return;
        }
        reject(error);
      });
      server.listen(port, () => {
        const address = server.address();
        const assigned =
          typeof address === 'object' && address ? address.port : port;
        server.close(() => resolve(assigned));
      });
    };
    probe(preferred ?? 0);
  });
}

async function waitForHealth(
  client: RuntimeClient,
  isAlive: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!isAlive()) {
      throw new Error('Runtime process exited before becoming healthy');
    }
    if (await client.health()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Runtime did not become healthy within 30000ms');
}

/**
 * Starts one identity-aware runtime for an eval suite.
 *
 * The caller owns the supplied directories and must stop the handle after all
 * suite tasks have completed.
 */
export async function startEvalRuntime(
  options: EvalRuntimeOptions,
): Promise<EvalRuntimeHandle> {
  const presetId = options.presetId ?? DEFAULT_PRESET_ID;
  const preset = getPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown model preset: ${presetId}`);
  }

  await fs.mkdir(options.execDir, { recursive: true });
  const port = await getAvailablePort(options.port);
  const models = { ...preset.tiers, ...options.models };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARTIFICER_IDENTITY_DIR: options.identityDir,
    ARTIFICER_EXEC_DIR: options.execDir,
    PORT: String(port),
    RUNTIME_EVAL_MODE: 'true',
    RUNTIME_CONCURRENCY: '1',
    RUNTIME_RESUME_ON_STARTUP: 'false',
    MODEL_PRESET: preset.id,
    LLM_MODEL_LOW: models.low,
    LLM_MODEL: models.medium,
    LLM_MODEL_HIGH: models.high,
  };

  for (const [role, tier] of Object.entries(preset.roleTiers)) {
    env[`RUNTIME_TIER_${role.toUpperCase()}`] = tier;
  }

  const child: ChildProcess = childProcess.spawn(
    process.execPath,
    await runtimeArgs(),
    {
      cwd: runtimeRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (data) =>
    process.stdout.write(`[eval-runtime] ${data}`),
  );
  child.stderr?.on('data', (data) =>
    process.stderr.write(`[eval-runtime] ${data}`),
  );

  let exitCode: number | null = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  const client = new RuntimeClient(`http://localhost:${port}`);
  const isAlive = () => exitCode === null;
  const stop = async (): Promise<void> => {
    if (!isAlive() || !child.pid) return;

    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (isAlive()) child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  try {
    await waitForHealth(client, isAlive);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    client,
    execDir: options.execDir,
    identityDir: options.identityDir,
    stop,
  };
}
