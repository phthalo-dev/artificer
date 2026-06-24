import path from 'node:path';

export async function dev(rootDir?: string): Promise<void> {
  const dir = rootDir ?? process.cwd();
  const resolved = path.resolve(dir);

  const { createRuntime } = await import('@artificer/runtime');

  const runtime = await createRuntime({ rootDir: resolved });

  console.log(
    `[artificer] Starting ${runtime.config.agentName} in dev mode`,
  );
  await runtime.start();
}
