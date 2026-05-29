#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';
import { DatabaseStack } from '../lib/database-stack';
import { ComputeStack } from '../lib/compute-stack';
import { AmplifyStack } from '../lib/amplify-stack';
import { AgentStack } from '../lib/agent-stack';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment') || 'dev';
const account =
  app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;
const region =
  app.node.tryGetContext('region') ||
  process.env.CDK_DEFAULT_REGION ||
  'us-east-1';

const enableAmplify = app.node.tryGetContext('enableAmplify') || false;
const githubTokenSecretArn =
  app.node.tryGetContext('githubTokenSecretArn') || '';

const props: cdk.StackProps = {
  env: {
    account,
    region,
  },
  terminationProtection: environment === 'prod',
};

const coreStack = new CoreStack(app, `ArtificerCoreStack-${environment}`, {
  ...props,
  environment,
});

const databaseStack = new DatabaseStack(
  app,
  `ArtificerDatabaseStack-${environment}`,
  {
    ...props,
    environment,
    vpc: coreStack.vpc,
    securityGroup: coreStack.controlPlaneSecurityGroup,
  },
);

const computeStack = new ComputeStack(
  app,
  `ArtificerComputeStack-${environment}`,
  {
    ...props,
    environment,
    vpc: coreStack.vpc,
    securityGroup: coreStack.controlPlaneSecurityGroup,
  },
);

if (enableAmplify && githubTokenSecretArn) {
  new AmplifyStack(app, `ArtificerAmplifyStack-${environment}`, {
    ...props,
    environment,
    githubTokenSecretArn,
  });
}

new AgentStack(app, `ArtificerAgentStack-${environment}`, {
  ...props,
  environment,
  vpc: coreStack.vpc,
  securityGroup: coreStack.agentSecurityGroup,
  agentRole: coreStack.agentEc2Role,
  logBucket: coreStack.agentLogBucket,
});

app.synth();
