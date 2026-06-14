import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  type InstanceStateName,
} from '@aws-sdk/client-ec2';

export interface WakeServiceConfig {
  region: string;
  /** EC2 instance id for the runtime host. */
  instanceId: string;
}

const RUNNABLE: InstanceStateName[] = ['running', 'pending'];
const STOPPED: InstanceStateName[] = ['stopped', 'stopping'];

function isRunnableState(state: InstanceStateName | 'unknown'): state is InstanceStateName {
  return state !== 'unknown' && RUNNABLE.includes(state);
}

function isStoppedState(state: InstanceStateName | 'unknown'): state is InstanceStateName {
  return state !== 'unknown' && STOPPED.includes(state);
}

export class WakeService {
  private client: EC2Client;
  private instanceId: string;

  constructor(config: WakeServiceConfig) {
    this.client = new EC2Client({ region: config.region });
    this.instanceId = config.instanceId;
  }

  async getInstanceState(): Promise<InstanceStateName | 'unknown'> {
    const result = await this.client.send(
      new DescribeInstancesCommand({ InstanceIds: [this.instanceId] }),
    );
    const instance = result.Reservations?.[0]?.Instances?.[0];
    return instance?.State?.Name ?? 'unknown';
  }

  async isRunning(): Promise<boolean> {
    const state = await this.getInstanceState();
    return isRunnableState(state);
  }

  async isStopped(): Promise<boolean> {
    const state = await this.getInstanceState();
    return isStoppedState(state);
  }

  /** Start the runtime EC2 instance if it is stopped. No-op if already running. */
  async ensureAwake(): Promise<InstanceStateName | 'unknown'> {
    const state = await this.getInstanceState();

    if (state === 'running' || state === 'pending') return state;

    if (state === 'stopped') {
      await this.client.send(
        new StartInstancesCommand({ InstanceIds: [this.instanceId] }),
      );
      return this.waitForState('running');
    }

    if (state === 'stopping') {
      await this.waitForState('stopped');
      return this.ensureAwake();
    }

    return state;
  }

  /** Stop the runtime EC2 instance. No-op if already stopped. */
  async hibernate(): Promise<void> {
    const state = await this.getInstanceState();
    if (state === 'stopped' || state === 'stopping') return;
    if (state === 'running') {
      await this.client.send(
        new StopInstancesCommand({ InstanceIds: [this.instanceId] }),
      );
    }
  }

  async waitForState(
    target: InstanceStateName,
    timeoutMs = 300_000,
    intervalMs = 5_000,
  ): Promise<InstanceStateName> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await this.getInstanceState();
      if (state === target) return state;
      if (state === 'terminated') {
        throw new Error(`Instance ${this.instanceId} was terminated`);
      }
      await sleep(intervalMs);
    }
    throw new Error(
      `Timeout waiting for instance ${this.instanceId} to reach ${target}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
