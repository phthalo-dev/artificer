import { randomBytes } from 'crypto';
import { EC2Service } from './ec2';
import { generateUserData } from './user-data';
import type {
  ProvisionInstanceInput,
  InstanceCredentials,
  InstanceInfo,
} from './types';
import { InstanceState } from './types';

export type {
  ProvisionInstanceInput,
  InstanceCredentials,
  InstanceInfo,
} from './types';
export { InstanceState } from './types';

export interface OrchestratorConfig {
  awsRegion: string;
  defaultSubnetId: string;
  defaultSecurityGroupIds: string[];
  defaultKeyName?: string;
  defaultInstanceType?: string;
  iamInstanceProfile?: string;
}

export class Orchestrator {
  private ec2: EC2Service;
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.ec2 = new EC2Service(config.awsRegion);
    this.config = config;
  }

  async provisionAgent(
    agentId: string,
    credentials: InstanceCredentials,
    customConfig?: Partial<ProvisionInstanceInput>,
  ): Promise<InstanceInfo> {
    const input: ProvisionInstanceInput = {
      instanceType:
        customConfig?.instanceType ||
        this.config.defaultInstanceType ||
        't3.medium',
      subnetId: customConfig?.subnetId || this.config.defaultSubnetId,
      securityGroupIds:
        customConfig?.securityGroupIds || this.config.defaultSecurityGroupIds,
      keyName: customConfig?.keyName || this.config.defaultKeyName,
      iamInstanceProfile:
        customConfig?.iamInstanceProfile || this.config.iamInstanceProfile,
    };

    const userData = generateUserData(credentials);
    const instanceName = `artificer-agent-${agentId}`;

    return this.ec2.provisionInstance(input, instanceName, userData);
  }

  async startAgent(instanceId: string): Promise<InstanceInfo> {
    return this.ec2.startInstance(instanceId);
  }

  async stopAgent(instanceId: string): Promise<InstanceInfo> {
    return this.ec2.stopInstance(instanceId);
  }

  async terminateAgent(instanceId: string): Promise<void> {
    await this.ec2.terminateInstance(instanceId);
  }

  async getAgentStatus(instanceId: string): Promise<{
    state: InstanceState;
    info: InstanceInfo | null;
  }> {
    const state = await this.ec2.getInstanceState(instanceId);
    const info = await this.ec2.describeInstance(instanceId);
    return { state, info };
  }

  generateOpenCodePassword(): string {
    return randomBytes(32).toString('hex');
  }

  buildAgentCredentials(
    anthropicApiKey: string,
    githubToken: string,
    githubSshKey: string,
    workDirectory: string = '/home/ubuntu/workspace',
  ): InstanceCredentials {
    return {
      opencodePassword: this.generateOpenCodePassword(),
      anthropicApiKey,
      githubToken,
      githubSshKey,
      workDirectory,
    };
  }
}
