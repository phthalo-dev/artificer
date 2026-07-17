import path from 'node:path';

export async function dev(rootDir?: string): Promise<void> {
  const dir = rootDir ?? process.cwd();
  const resolved = path.resolve(dir);

  const { createRuntime } = await import('@artificer-ai/runtime');

  const runtime = await createRuntime({ rootDir: resolved });
  await runtime.start();

  const verbose = process.env.ARTIFICER_VERBOSE === 'true';

  runtime.engine.subscribe((event) => {
    switch (event.kind) {
      case 'message': {
        const msg = event.data as { direction?: string };
        if (msg.direction === 'inbound') {
          console.log('[artificer] → message received');
        }
        break;
      }
      case 'workstream': {
        const ws = event.data as { status?: string; title?: string };
        console.log(
          `[artificer] workstream:${ws.status ?? '?'} "${ws.title ?? ''}"`,
        );
        break;
      }
      case 'run': {
        const run = event.data as { status?: string; role?: string };
        console.log(`[artificer] run:${run.status ?? '?'} ${run.role ?? ''}`);
        break;
      }
      case 'tool': {
        if (verbose) {
          console.log(`[artificer] tool ${event.data.name}`);
        }
        break;
      }
    }
  });
}
