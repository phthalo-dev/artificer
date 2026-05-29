import { z } from 'zod';

export const ProvisionInstanceInputSchema = z.object({
  instanceType: z.string().default('t3.medium'),
  subnetId: z.string(),
  securityGroupIds: z.array(z.string()),
  keyName: z.string().optional(),
  iamInstanceProfile: z.string().optional(),
});

export type ProvisionInstanceInput = z.infer<
  typeof ProvisionInstanceInputSchema
>;

export const InstanceCredentialsSchema = z.object({
  opencodePassword: z.string(),
  anthropicApiKey: z.string(),
  githubToken: z.string(),
  githubSshKey: z.string(),
  githubEmail: z.string().optional(),
  githubUsername: z.string().optional(),
  workDirectory: z.string().default('/home/ubuntu/workspace'),
});

export type InstanceCredentials = z.infer<typeof InstanceCredentialsSchema>;

export interface InstanceInfo {
  instanceId: string;
  publicIp: string;
  privateIp: string;
  state: string;
  opencodePort: number;
}

export enum InstanceState {
  PENDING = 'pending',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  TERMINATING = 'terminating',
  TERMINATED = 'terminated',
}
