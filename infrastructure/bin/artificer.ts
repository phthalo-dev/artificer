#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RuntimeStack } from '../lib/runtime-stack';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment') || 'personal';
const account =
  app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;
const region =
  app.node.tryGetContext('region') ||
  process.env.CDK_DEFAULT_REGION ||
  'us-east-1';

const agentGithubUsername = app.node.tryGetContext('agentGithubUsername') as
  | string
  | undefined;
const agentRepo = app.node.tryGetContext('agentRepo') as string | undefined;

new RuntimeStack(app, `ArtificerRuntimeStack-${environment}`, {
  env: { account, region },
  environment,
  agentGithubUsername,
  agentRepo,
  description: 'Artificer personal runtime — hibernating EC2 + SQS wake API',
});

app.synth();
