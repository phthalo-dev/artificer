import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BenchConfig } from './config.js';
import { RUNTIME_ROOT } from './config.js';
import { RuntimeClient } from './client.js';

export interface RuntimeHandle {
  client: RuntimeClient;
  /** Isolated exec dir for this runtime instance. */
  execDir: string;
  /** Stops the process and (unless keepData) removes the exec dir. */
  stop: () => Promise<void>;
}

const RUNTIME_ENTRY = path.join(RUNTIME_ROOT, 'src', 'index.ts');

/** Prefer `preferred`; if taken, bind port 0 and return whatever the OS assigns. */
function getAvailablePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = (port: number) => {
      const server = net.createServer();
      server.unref();
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port !== 0) {
          probe(0);
          return;
        }
        reject(err);
      });
      server.listen(port, () => {
        const addr = server.address();
        const assigned =
          typeof addr === 'object' && addr ? addr.port : port;
        server.close(() => resolve(assigned));
      });
    };
    probe(preferred ?? 0);
  });
}

async function waitForHealth(
  client: RuntimeClient,
  timeoutMs: number,
  isAlive: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) {
      throw new Error('Runtime process exited before becoming healthy');
    }
    if (await client.health()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Runtime did not become healthy within ${timeoutMs}ms`);
}

/**
 * Spawns a fully isolated runtime for a single benchmark instance: a fresh
 * temp data dir, concurrency pinned to 1, resume disabled, and the configured
 * tier models. The agent's own credentials (LLM key, optional GITHUB_TOKEN)
 * are inherited from the parent environment / the runtime's .env.
 */
export async function startRuntime(
  config: BenchConfig,
  label: string,
): Promise<RuntimeHandle> {
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, '_');
  const execDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `artificer-bench-${safeLabel}-`),
  );

  const port = await getAvailablePort(config.runtimePort);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARTIFICER_EXEC_DIR: execDir,
    PORT: String(port),
    RUNTIME_CONCURRENCY: '1',
    RUNTIME_MAX_RUNS_PER_WORKSTREAM: String(config.maxRunsPerWorkstream),
    RUNTIME_MAX_ITERATIONS: String(config.maxIterationsPerCall),
    RUNTIME_RESUME_ON_STARTUP: 'false',
    LLM_MODEL: config.models.medium,
    LLM_MODEL_LOW: config.models.low,
    LLM_MODEL_HIGH: config.models.high,
    MODEL_PRESET: config.presetId ?? 'custom',
    // Gateway overrides — only set when --gateway was passed, so the .env
    // defaults are left untouched for runs that don't specify a gateway.
    ...(config.baseUrl !== undefined ? { LLM_BASE_URL: config.baseUrl } : {}),
    ...(config.apiKey !== undefined ? { LLM_API_KEY: config.apiKey } : {}),
  };

  for (const [role, tier] of Object.entries(config.roleTiers)) {
    env[`RUNTIME_TIER_${role.toUpperCase()}`] = tier;
  }

  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', RUNTIME_ENTRY],
    { cwd: RUNTIME_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Surface runtime logs with an instance prefix so a long suite is debuggable.
  const prefix = `[runtime:${safeLabel}]`;
  child.stdout?.on('data', (d) => process.stdout.write(`${prefix} ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`${prefix} ${d}`));

  let exitCode: number | null = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  const client = new RuntimeClient(`http://localhost:${port}`);
  const isAlive = () => exitCode === null;

  const stop = async (): Promise<void> => {
    if (isAlive() && child.pid) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          if (isAlive()) child.kill('SIGKILL');
          resolve();
        }, 5_000);
        child.on('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (!config.keepData) {
      await fs.rm(execDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  if (port !== config.runtimePort) {
    // eslint-disable-next-line no-console
    console.log(
      `[bench]   port ${config.runtimePort} busy — using ${port} for this instance`,
    );
  }

  try {
    await waitForHealth(client, 30_000, isAlive);
  } catch (err) {
    await stop();
    throw err;
  }

  return { client, execDir, stop };
}
