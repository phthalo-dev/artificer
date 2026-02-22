export interface EC2InstanceConfig {
  instanceType: string;
  imageId: string;
  keyName: string;
  securityGroupIds: string[];
  subnetId: string;
  iamInstanceProfile?: string;
  userData?: string;
  tags?: Record<string, string>;
}

export interface EC2Instance {
  instanceId: string;
  publicIp?: string;
  privateIp?: string;
  state: EC2InstanceState;
  launchTime: Date;
}

export enum EC2InstanceState {
  PENDING = 'pending',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  TERMINATING = 'terminating',
  TERMINATED = 'terminated',
}

export interface OpenCodeConfig {
  anthropicApiKey: string;
  workDirectory: string;
  logLevel?: string;
  autoCommit?: boolean;
  [key: string]: unknown;
}

export interface GitHubCredentials {
  username: string;
  email: string;
  sshPrivateKey: string;
  token: string;
}
