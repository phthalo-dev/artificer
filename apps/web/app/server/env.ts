import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ENCRYPTION_KEY: z.string().min(32),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  EC2_KEY_NAME: z.string().optional(),
  EC2_SECURITY_GROUP_ID: z.string().optional(),
  EC2_SUBNET_ID: z.string().optional(),
  EC2_INSTANCE_TYPE: z.string().default('t3.medium'),
  EC2_AMI_ID: z.string().optional(),
  EC2_IAM_INSTANCE_PROFILE: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);
