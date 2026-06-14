import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { QueueBridge } from './queue-bridge.js';
import { WakeService } from './wake.js';
import { IdleMonitor } from './idle-monitor.js';

export interface BridgeConfig {
  region: string;
  queueUrl: string;
  runtimeUrl: string;
  runtimeAuthToken?: string;
  instanceId: string;
  hibernateIdleMs: number;
  pollIntervalMs?: number;
}

export function loadBridgeConfigFromEnv(): BridgeConfig {
  const region = required('AWS_REGION');
  const queueUrl = required('SQS_QUEUE_URL');
  const runtimeUrl = process.env.RUNTIME_URL ?? 'http://127.0.0.1:4100';
  const instanceId = required('RUNTIME_INSTANCE_ID');
  const hibernateIdleMs = Number(process.env.HIBERNATE_IDLE_MS ?? 900_000);
  const runtimeAuthToken = process.env.RUNTIME_AUTH_TOKEN;
  const pollIntervalMs = process.env.BRIDGE_POLL_INTERVAL_MS
    ? Number(process.env.BRIDGE_POLL_INTERVAL_MS)
    : 30_000;

  return {
    region,
    queueUrl,
    runtimeUrl,
    runtimeAuthToken,
    instanceId,
    hibernateIdleMs,
    pollIntervalMs,
  };
}

/** Sidecar loop: forward SQS messages to the local runtime, hibernate when idle. */
export async function runBridge(config: BridgeConfig): Promise<void> {
  const wake = new WakeService({
    region: config.region,
    instanceId: config.instanceId,
  });

  const bridge = new QueueBridge({
    region: config.region,
    queueUrl: config.queueUrl,
    runtimeUrl: config.runtimeUrl,
    runtimeAuthToken: config.runtimeAuthToken,
    waitTimeSeconds: 20,
  });

  const idleMonitor = new IdleMonitor({
    runtimeUrl: config.runtimeUrl,
    runtimeAuthToken: config.runtimeAuthToken,
    idleMs: config.hibernateIdleMs,
    pollIntervalMs: config.pollIntervalMs,
    wakeService: wake,
  });

  console.log(
    `[bridge] listening on ${config.queueUrl} → ${config.runtimeUrl}`,
  );
  console.log(
    `[bridge] hibernate after ${config.hibernateIdleMs}ms idle on instance ${config.instanceId}`,
  );

  // Wait for runtime container to be up on boot.
  await bridge.getRuntimeClient().waitUntilHealthy();
  await bridge.drainAfterWake();

  void idleMonitor.run();

  for (;;) {
    await bridge.pollOnce();
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runBridge(loadBridgeConfigFromEnv()).catch((err) => {
    console.error('[bridge] fatal:', err);
    process.exit(1);
  });
}
