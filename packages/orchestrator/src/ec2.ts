import {
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
} from '@aws-sdk/client-ec2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { ProvisionInstanceInput, InstanceInfo } from './types';
import { InstanceState } from './types';

// Ubuntu 22.04 LTS — latest AMI resolved per-region via SSM
const UBUNTU_2204_SSM_PATH =
  '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id';

export class EC2Service {
  private client: EC2Client;
  private ssm: SSMClient;
  private configuredImageId: string | undefined;
  private readonly defaultPort = 4096;

  constructor(region: string = 'us-east-1', imageId?: string) {
    this.client = new EC2Client({ region });
    this.ssm = new SSMClient({ region });
    this.configuredImageId = imageId;
  }

  private async resolveImageId(): Promise<string> {
    if (this.configuredImageId) return this.configuredImageId;
    const result = await this.ssm.send(
      new GetParameterCommand({ Name: UBUNTU_2204_SSM_PATH }),
    );
    const ami = result.Parameter?.Value;
    if (!ami) throw new Error('Could not resolve Ubuntu 22.04 AMI from SSM');
    return ami;
  }

  async provisionInstance(
    input: ProvisionInstanceInput,
    instanceName: string,
    userData: string,
  ): Promise<InstanceInfo> {
    const imageId = await this.resolveImageId();
    const command = new RunInstancesCommand({
      InstanceType: input.instanceType as never,
      ImageId: imageId,
      KeyName: input.keyName,
      // Use NetworkInterfaces to explicitly assign a public IP.
      // Note: SecurityGroupIds and SubnetId must not be set at the top level
      // when NetworkInterfaces is used — they go inside the interface.
      NetworkInterfaces: [
        {
          DeviceIndex: 0,
          SubnetId: input.subnetId,
          Groups: input.securityGroupIds,
          AssociatePublicIpAddress: true,
        },
      ],
      IamInstanceProfile: input.iamInstanceProfile
        ? { Name: input.iamInstanceProfile }
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

    try {
      const result = await this.client.send(command);
      const instance = result.Reservations?.[0]?.Instances?.[0];

      if (!instance) {
        // Instance not yet visible — treat as pending
        return InstanceState.PENDING;
      }

      return (instance.State?.Name || 'unknown') as InstanceState;
    } catch (err: any) {
      // AWS propagation delay: instance exists but isn't queryable yet
      if (err?.Code === 'InvalidInstanceID.NotFound') {
        return InstanceState.PENDING;
      }
      throw err;
    }
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
