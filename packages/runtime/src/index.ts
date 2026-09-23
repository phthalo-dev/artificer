import 'dotenv/config';
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { loadConfigWithIdentityDefinition } from './config.js';
import { Engine } from './engine/engine.js';
import { runGithubWatchOnce } from './engine/github-watch-runner.js';
import { runIdentityPullCycle } from './engine/identity-pull.js';
import { createScheduleRunnerForEngine } from './engine/schedule-runner-host.js';
import { createApp } from './server/app.js';
import { IdentityGitSync } from './storage/identity-git-sync.js';
import { Store } from './storage/store.js';

export { loadConfig, mergeWithDefinition } from './config.js';
export { Engine } from './engine/engine.js';
export {
  DEFAULT_PRESET_ID,
  getPreset,
  isPresetId,
  listPresets,
} from './engine/presets.js';
export type { ModelPreset } from './engine/presets.js';
export { Store } from './storage/store.js';
export { TraceRecorder } from './storage/trace-recorder.js';
export type { TraceSink } from './storage/trace-recorder.js';
export { WorkstreamReceiptService } from './engine/workstream-receipt.js';
export { buildReceiptSummaryTask } from './engine/workstream-receipt.js';
export { formatReceiptForChannel } from './channels/receipt-format.js';
export type {
  ReceiptChanges,
  ReceiptFinding,
  ReceiptLinks,
  ReceiptProvenance,
  ReceiptReview,
  ReceiptStep,
  ReceiptUsage,
  ReceiptValidation,
  WorkstreamReceipt,
  WorkstreamReceiptResult,
} from './engine/workstream-receipt.js';
export { createApp } from './server/app.js';
export type * from './storage/types.js';
export { defineTool } from './api/define-tool.js';
export { ToolRegistry } from './api/tool-registry.js';
export { createRuntime } from './api/create-runtime.js';
export type { RuntimeOptions, ArtificerRuntime } from './api/types.js';
export {
  scanAgentDirectory,
  type AgentManifest,
  type ModuleRef,
} from './discover/discover.js';
export {
  loadSkillsFromDisk,
  loadInstructionsFromDisk,
  loadChannelsFromDisk,
} from './discover/loader.js';
export { defineChannel } from './api/define-channel.js';
export { defineSkill } from './api/define-skill.js';
export type {
  ArtificerConfig,
  ExecutorConfig,
  IdentityConfig,
  ToolDefinition,
  ArtificerTool,
  ChannelDefinition,
  ArtificerChannel,
  ChannelMessage,
  ChannelOutput,
  SkillDefinition,
  ArtificerSkill,
} from './api/types.js';
export type { WorkerExecutor, ExecutorResult } from './engine/executor.js';
export { defineConnection } from './api/define-connection.js';
export type {
  ConnectionDefinition,
  ConnectionAuth,
  ArtificerConnection,
} from './api/types.js';
export {
  slackChannel,
  postSlackReply,
  updateSlackStatus,
} from './channels/adapters/slack.js';
export {
  discordChannel,
  editDiscordResponse,
} from './channels/adapters/discord.js';
export {
  verifySlackSignature,
  verifyDiscordSignature,
} from './channels/adapters/verify.js';
export {
  applyHistoryImport,
  planHistoryImport,
  HISTORY_SOURCES,
} from './import-history/index.js';
export type {
  HistoryImportPlan,
  HistorySource,
  MemoryDraft,
  PlanHistoryImportOptions,
} from './import-history/index.js';

export async function startRuntime(): Promise<void> {
  const config = loadConfigWithIdentityDefinition();
  const store = new Store(config.execDir);
  await store.init();

  const identity = config.identity
    ? new IdentityGitSync(
        config.identityDir,
        config.identity,
        config.github,
        Boolean(config.evalMode),
      )
    : undefined;
  await identity?.init();
  const engine = new Engine(config, store, undefined, undefined, identity);
  await engine.initializeTraces();
  await engine.reconcileServices();
  const scheduleRunner = createScheduleRunnerForEngine(engine);

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

  scheduleRunner.start();
  // eslint-disable-next-line no-console
  console.log('[artificer-runtime] Schedule runner enabled');

  const pullIntervalMs = config.identity?.pullIntervalMs;
  if (
    pullIntervalMs &&
    engine.identity instanceof IdentityGitSync &&
    !config.evalMode
  ) {
    const scheduleNextPull = () => {
      setTimeout(() => {
        runIdentityPullCycle({
          identity: engine.identity as IdentityGitSync,
          reloadSchedules: () => engine.reloadSchedules(),
          log: (message) =>
            // eslint-disable-next-line no-console
            console.log(`[artificer-runtime] [identity-pull] ${message}`),
        })
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[artificer-runtime] identity pull failed:', err);
          })
          .finally(scheduleNextPull);
      }, pullIntervalMs);
    };
    scheduleNextPull();
    // eslint-disable-next-line no-console
    console.log(
      `[artificer-runtime] Identity pull enabled (every ${pullIntervalMs}ms)`,
    );
  }

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(
      `[artificer-runtime] ${config.agentName} listening on http://localhost:${info.port}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[artificer-runtime] exec dir: ${config.execDir}`);
  });

  const watchIntervalMs = config.github?.watchIntervalMs;
  if (watchIntervalMs) {
    const scheduleNextWatch = () => {
      setTimeout(() => {
        runGithubWatchOnce(engine, (msg) =>
          // eslint-disable-next-line no-console
          console.log(`[artificer-runtime] [github-watch] ${msg}`),
        )
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error(
              '[artificer-runtime] github watch cycle failed:',
              err,
            );
          })
          .finally(scheduleNextWatch);
      }, watchIntervalMs);
    };
    scheduleNextWatch();
    // eslint-disable-next-line no-console
    console.log(
      `[artificer-runtime] GitHub watcher enabled (every ${watchIntervalMs}ms)`,
    );
  }
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
