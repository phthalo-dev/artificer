import path from 'node:path';

export async function start(rootDir?: string): Promise<void> {
  const dir = rootDir ?? process.cwd();
  const resolved = path.resolve(dir);

  if (!process.env.ARTIFICER_API_KEY) {
    console.warn(
      '[artificer] Warning: ARTIFICER_API_KEY is not set. API authentication is disabled.',
    );
    console.warn(
      '[artificer] Set ARTIFICER_API_KEY in your .env for production use.',
    );
  }

  const { createRuntime } = await import('@artificer/runtime');

  const runtime = await createRuntime({ rootDir: resolved });

  console.log(
    `[artificer] Starting ${runtime.config.agentName} in production mode`,
  );
  await runtime.start();
}
