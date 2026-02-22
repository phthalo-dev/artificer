import {
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import type { ProvisionInstanceInput, InstanceInfo } from './types';
import { InstanceState } from './types';

export class EC2Service {
  private client: EC2Client;
  private readonly defaultImageId = 'ami-0c55b159cbfafe1f0';
  private readonly defaultPort = 4096;

  constructor(region: string = 'us-east-1') {
    this.client = new EC2Client({ region });
  }

  async provisionInstance(
    input: ProvisionInstanceInput,
    instanceName: string,
    userData: string,
  ): Promise<InstanceInfo> {
    const command = new RunInstancesCommand({
      InstanceType: input.instanceType as never,
      ImageId: input.iamInstanceProfile
        ? 'ami-0c55b159cbfafe1f0'
        : this.defaultImageId,
      KeyName: input.keyName,
      SecurityGroupIds: input.securityGroupIds,
      SubnetId: input.subnetId,
      IamInstanceProfile: input.iamInstanceProfile
        ? { Arn: input.iamInstanceProfile }
        : undefined,
      UserData: Buffer.from(userData).toString('base64'),
      MinCount: 1,
      MaxCount: 1,
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            { Key: 'Name', Value: instanceName },
            { Key: 'ManagedBy', Value: 'Artificer' },
          ],
        },
      ],
    });

    const result = await this.client.send(command);
    const instance = result.Instances?.[0];

    if (!instance?.InstanceId) {
      throw new Error('Failed to provision instance');
    }

    await this.waitForInstanceState(instance.InstanceId, InstanceState.RUNNING);

    const instanceInfo = await this.describeInstance(instance.InstanceId);

    if (!instanceInfo) {
      throw new Error('Failed to get instance info after provisioning');
    }

    return instanceInfo;
  }

  async startInstance(instanceId: string): Promise<InstanceInfo> {
    const command = new StartInstancesCommand({ InstanceIds: [instanceId] });
    await this.client.send(command);

    await this.waitForInstanceState(instanceId, InstanceState.RUNNING);

    const instanceInfo = await this.describeInstance(instanceId);
    if (!instanceInfo) {
      throw new Error('Failed to get instance info after starting');
    }

    return instanceInfo;
  }

  async stopInstance(instanceId: string): Promise<InstanceInfo> {
    const command = new StopInstancesCommand({ InstanceIds: [instanceId] });
    await this.client.send(command);

    await this.waitForInstanceState(instanceId, InstanceState.STOPPED);

    const instanceInfo = await this.describeInstance(instanceId);
    if (!instanceInfo) {
      throw new Error('Failed to get instance info after stopping');
    }

    return instanceInfo;
  }

  async terminateInstance(instanceId: string): Promise<void> {
    const command = new TerminateInstancesCommand({
      InstanceIds: [instanceId],
    });
    await this.client.send(command);
  }

  async describeInstance(instanceId: string): Promise<InstanceInfo | null> {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });

    const result = await this.client.send(command);
    const instance = result.Reservations?.[0]?.Instances?.[0];

    if (!instance) {
      return null;
    }

    return {
      instanceId: instance.InstanceId!,
      publicIp: instance.PublicIpAddress || '',
      privateIp: instance.PrivateIpAddress || '',
      state: instance.State?.Name || 'unknown',
      opencodePort: this.defaultPort,
    };
  }

  async getInstanceState(instanceId: string): Promise<InstanceState> {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });

    const result = await this.client.send(command);
    const instance = result.Reservations?.[0]?.Instances?.[0];

    if (!instance) {
      throw new Error('Instance not found');
    }

    return (instance.State?.Name || 'unknown') as InstanceState;
  }

  async waitForInstanceState(
    instanceId: string,
    targetState: InstanceState,
    timeoutMs: number = 300000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = await this.getInstanceState(instanceId);

      if (state === targetState) {
        return;
      }

      if (state === InstanceState.TERMINATED) {
        throw new Error('Instance was terminated while waiting');
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(
      `Timeout waiting for instance ${instanceId} to reach state ${targetState}`,
    );
  }
}
