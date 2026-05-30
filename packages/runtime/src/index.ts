import 'dotenv/config';
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { Engine } from './engine/engine.js';
import { createApp } from './server/app.js';
import { Store } from './storage/store.js';

export { loadConfig } from './config.js';
export { Engine } from './engine/engine.js';
export { Store } from './storage/store.js';
export { createApp } from './server/app.js';
export type * from './storage/types.js';

export async function startRuntime(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dataDir);
  await store.init();

  const engine = new Engine(config, store);

  const recovered = await engine.recoverZombieRuns();
  if (recovered.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[artificer-runtime] recovered ${recovered.length} zombie run(s) from a previous session`,
    );
    if (config.resumeOnStartup) {
      const resumed = await engine.resumeInterruptedWorkstreams(recovered);
      if (resumed > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[artificer-runtime] resumed ${resumed} interrupted workstream(s)`,
        );
      }
    }
  }

  const app = createApp(engine);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(
      `[artificer-runtime] ${config.agentName} listening on http://localhost:${info.port}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[artificer-runtime] data dir: ${config.dataDir}`);
  });
}

// Start the server only when this file is executed directly.
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startRuntime().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[artificer-runtime] failed to start:', err);
    process.exit(1);
  });
}
