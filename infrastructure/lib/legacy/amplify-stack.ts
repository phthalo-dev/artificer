import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import { Construct } from 'constructs';

export interface AmplifyStackProps extends cdk.StackProps {
  environment: string;
  githubTokenSecretArn: string;
}

export class AmplifyStack extends cdk.Stack {
  public readonly appId: string;
  public readonly appArn: string;

  constructor(scope: Construct, id: string, props: AmplifyStackProps) {
    super(scope, id, props);

    const { environment, githubTokenSecretArn } = props;

    const buildSpecYaml = `
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci -g pnpm@8.15.1
        - pnpm install --frozen-lockfile
    build:
      commands:
        - pnpm build
  artifacts:
    baseDirectory: apps/web/dist
    files:
      - '**/*'
  cache:
    paths:
      - '**/node_modules/**/*'
`;

    const amplifyApp = new amplify.CfnApp(this, 'ArtificerApp', {
      name: `artificer-${environment}`,
      description: 'Artificer AI coding agent platform',
      oauthToken:
        cdk.SecretValue.secretsManager(githubTokenSecretArn).toString(),
      buildSpec: buildSpecYaml,
      platform: 'WEB_COMPUTE',
      tags: [
        { key: 'Environment', value: environment },
        { key: 'Project', value: 'Artificer' },
      ],
    });

    this.appId = amplifyApp.ref;
    this.appArn = amplifyApp.attrArn;

    new amplify.CfnBranch(this, 'MainBranch', {
      appId: this.appId,
      branchName: environment === 'prod' ? 'main' : 'develop',
      stage: environment === 'prod' ? 'PRODUCTION' : 'DEVELOPMENT',
      buildSpec: buildSpecYaml,
    });

    new cdk.CfnOutput(this, 'AmplifyAppId', {
      value: this.appId,
      exportName: `artificer-${environment}-amplify-app-id`,
    });

    new cdk.CfnOutput(this, 'AmplifyAppArn', {
      value: this.appArn,
      exportName: `artificer-${environment}-amplify-app-arn`,
    });
  }
}
