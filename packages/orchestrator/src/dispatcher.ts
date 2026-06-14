import type { InboundWork, WorkDispatchResult, WorkDispatcher } from '@artificer/agent-gateway';
import { QueueBridge } from './queue-bridge.js';
import { WakeService } from './wake.js';

/** Enqueue work and wake the runtime host if it is hibernating. */
export class CloudWorkDispatcher implements WorkDispatcher {
  constructor(
    private readonly bridge: QueueBridge,
    private readonly wake: WakeService,
  ) {}

  async dispatch(work: InboundWork): Promise<WorkDispatchResult> {
    await this.bridge.enqueue(work);
    await this.wake.ensureAwake();
    return {
      accepted: true,
      message: 'work queued; runtime waking if needed',
    };
  }
}

export function createCloudWorkDispatcher(options: {
  region: string;
  queueUrl: string;
  instanceId: string;
}): CloudWorkDispatcher {
  const bridge = new QueueBridge({
    region: options.region,
    queueUrl: options.queueUrl,
    runtimeUrl: process.env.RUNTIME_URL ?? 'http://127.0.0.1:4100',
    runtimeAuthToken: process.env.RUNTIME_AUTH_TOKEN,
  });
  const wake = new WakeService({
    region: options.region,
    instanceId: options.instanceId,
  });
  return new CloudWorkDispatcher(bridge, wake);
}
