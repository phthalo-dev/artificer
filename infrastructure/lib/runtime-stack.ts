import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Construct } from 'constructs';

export interface RuntimeStackProps extends cdk.StackProps {
  environment: string;
  agentGithubUsername?: string;
  agentRepo?: string;
}

/** CloudFront rejects IP literal origins; nip.io maps 1.2.3.4 → 1-2-3-4.nip.io. */
function nipIoOriginDomain(eipToken: string): string {
  return cdk.Fn.join('', [
    cdk.Fn.join('-', cdk.Fn.split('.', eipToken)),
    '.nip.io',
  ]);
}

/** Runtime HTTP paths proxied through CloudFront to the EC2 host. */
const RUNTIME_API_PATHS = [
  '/health',
  '/state',
  '/messages',
  '/messages/*',
  '/workstreams',
  '/workstreams/*',
  '/memories',
  '/memories/*',
  '/usage',
  '/config/*',
  '/bench/*',
  '/events',
];

/**
 * Personal runtime stack: EC2 + ECR + SQS + wake API + CloudFront console (@artificer-ai/ui).
 */
export class RuntimeStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly instance: ec2.Instance;
  public readonly queue: sqs.Queue;
  public readonly httpApi: apigwv2.HttpApi;
  public readonly consoleDistribution: cloudfront.Distribution;
  public readonly uiBucket: s3.Bucket;
  public readonly runtimeRepo: ecr.Repository;
  public readonly bridgeRepo: ecr.Repository;
  public readonly elasticIp: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: RuntimeStackProps) {
    super(scope, id, props);

    const { environment, agentGithubUsername, agentRepo } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `artificer-${environment}-runtime`,
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    this.runtimeRepo = new ecr.Repository(this, 'RuntimeRepo', {
      repositoryName: `artificer-${environment}-runtime`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [{ maxImageCount: 5 }],
    });

    this.bridgeRepo = new ecr.Repository(this, 'BridgeRepo', {
      repositoryName: `artificer-${environment}-bridge`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [{ maxImageCount: 5 }],
    });

    const apiAuthSecret = new secretsmanager.Secret(this, 'ApiAuthToken', {
      secretName: `artificer/${environment}/api-auth-token`,
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    const runtimeEnvSecret = new secretsmanager.Secret(this, 'RuntimeEnv', {
      secretName: `artificer/${environment}/runtime-env`,
      description:
        'Runtime env vars as JSON, e.g. {"ANTHROPIC_API_KEY":"...","AGENT_NAME":"cloud-agent"}',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          AGENT_NAME: 'cloud-agent',
          ARTIFICER_DATA_DIR: '/data',
          PORT: '4100',
        }),
      ),
    });

    const githubWebhookSecret = new secretsmanager.Secret(
      this,
      'GitHubWebhookSecret',
      {
        secretName: `artificer/${environment}/github-webhook-secret`,
        generateSecretString: {
          passwordLength: 32,
          excludePunctuation: true,
        },
      },
    );

    this.queue = new sqs.Queue(this, 'WorkQueue', {
      queueName: `artificer-${environment}-work`,
      visibilityTimeout: cdk.Duration.minutes(5),
      retentionPeriod: cdk.Duration.days(14),
    });

    const securityGroup = new ec2.SecurityGroup(this, 'RuntimeSecurityGroup', {
      vpc: this.vpc,
      description: 'Artificer runtime host',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(4100),
      'Runtime HTTP API (CloudFront origin)',
    );

    const role = new iam.Role(this, 'RuntimeInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
      ],
    });

    this.queue.grantConsumeMessages(role);
    this.queue.grantSendMessages(role);
    this.runtimeRepo.grantPull(role);
    this.bridgeRepo.grantPull(role);
    runtimeEnvSecret.grantRead(role);

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StopInstances', 'ec2:DescribeInstances'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'ec2:ResourceTag/ManagedBy': 'artificer-runtime',
          },
        },
      }),
    );

    const dataVolume = new ec2.Volume(this, 'DataVolume', {
      availabilityZone: this.vpc.publicSubnets[0].availabilityZone,
      size: cdk.Size.gibibytes(30),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userDataScript = readFileSync(
      join(__dirname, '../user-data/runtime-setup.sh'),
      'utf8',
    );
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      `export AWS_REGION=${cdk.Stack.of(this).region}`,
      `export ARTIFICER_ECR_RUNTIME=${this.runtimeRepo.repositoryUri}`,
      `export ARTIFICER_ECR_BRIDGE=${this.bridgeRepo.repositoryUri}`,
      `export SQS_QUEUE_URL=${this.queue.queueUrl}`,
      `export RUNTIME_ENV_SECRET_ARN=${runtimeEnvSecret.secretArn}`,
      userDataScript,
    );

    this.instance = new ec2.Instance(this, 'RuntimeHost', {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.SMALL,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup,
      role,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    cdk.Tags.of(this.instance).add('ManagedBy', 'artificer-runtime');
    cdk.Tags.of(this.instance).add('Project', 'artificer');

    new ec2.CfnVolumeAttachment(this, 'DataVolumeAttachment', {
      volumeId: dataVolume.volumeId,
      instanceId: this.instance.instanceId,
      device: '/dev/xvdf',
    });

    this.elasticIp = new ec2.CfnEIP(this, 'RuntimeEip', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: `artificer-${environment}-runtime` }],
    });

    new ec2.CfnEIPAssociation(this, 'RuntimeEipAssociation', {
      allocationId: this.elasticIp.attrAllocationId,
      instanceId: this.instance.instanceId,
    });

    const lambdaEnv = {
      SQS_QUEUE_URL: this.queue.queueUrl,
      RUNTIME_INSTANCE_ID: this.instance.instanceId,
    };

    const httpHandler = new lambdaNode.NodejsFunction(this, 'WorkHttpHandler', {
      entry: join(
        __dirname,
        '../../packages/orchestrator/lambda/http-handler.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...lambdaEnv,
        API_AUTH_TOKEN: apiAuthSecret.secretValue.unsafeUnwrap(),
      },
      bundling: {
        externalModules: ['@aws-sdk/client-ec2', '@aws-sdk/client-sqs'],
      },
    });

    this.queue.grantSendMessages(httpHandler);
    httpHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StartInstances', 'ec2:DescribeInstances'],
        resources: ['*'],
      }),
    );

    const githubHandler = new lambdaNode.NodejsFunction(
      this,
      'GitHubWebhookHandler',
      {
        entry: join(
          __dirname,
          '../../packages/orchestrator/lambda/github-handler.ts',
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        environment: {
          ...lambdaEnv,
          GITHUB_WEBHOOK_SECRET:
            githubWebhookSecret.secretValue.unsafeUnwrap(),
          AGENT_GITHUB_USERNAME: agentGithubUsername ?? 'artificer-bot',
          AGENT_GITHUB_TOKEN: 'configure-after-deploy',
          AGENT_REPO: agentRepo ?? 'owner/repo',
        },
        bundling: {
          externalModules: ['@aws-sdk/client-ec2', '@aws-sdk/client-sqs'],
        },
      },
    );

    this.queue.grantSendMessages(githubHandler);
    githubHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StartInstances', 'ec2:DescribeInstances'],
        resources: ['*'],
      }),
    );

    this.httpApi = new apigwv2.HttpApi(this, 'WakeApi', {
      apiName: `artificer-${environment}-wake`,
      description: 'Enqueue work and wake the Artificer runtime',
      corsPreflight: {
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ['*'],
      },
    });

    this.httpApi.addRoutes({
      path: '/work',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration(
        'WorkIntegration',
        httpHandler,
      ),
    });

    this.httpApi.addRoutes({
      path: '/webhooks/github',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration(
        'GitHubIntegration',
        githubHandler,
      ),
    });

    // --- UI on S3 + CloudFront, API paths proxied to EC2 ---

    this.uiBucket = new s3.Bucket(this, 'UiBucket', {
      bucketName: `artificer-${environment}-ui-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const runtimeOriginDomain = nipIoOriginDomain(this.elasticIp.ref);

    const runtimeOrigin = new origins.HttpOrigin(runtimeOriginDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 4100,
      originShieldEnabled: false,
    });

    const apiCachePolicy = new cloudfront.CachePolicy(this, 'RuntimeApiCache', {
      cachePolicyName: `artificer-${environment}-api-no-cache`,
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'Authorization',
        'Content-Type',
        'Accept',
      ),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
    });

    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(
      this,
      'RuntimeApiOriginRequest',
      {
        originRequestPolicyName: `artificer-${environment}-api-origin`,
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          'Content-Type',
          'Accept',
        ),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      },
    );

    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    for (const pathPattern of RUNTIME_API_PATHS) {
      additionalBehaviors[pathPattern] = {
        origin: runtimeOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: apiCachePolicy,
        originRequestPolicy: apiOriginRequestPolicy,
        compress: true,
      };
    }

    this.consoleDistribution = new cloudfront.Distribution(this, 'Console', {
      comment: `Artificer ${environment} runtime console`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.uiBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // --- outputs ---

    new cdk.CfnOutput(this, 'ConsoleUrl', {
      value: `https://${this.consoleDistribution.distributionDomainName}`,
      description: 'Runtime UI — send messages and view workstreams',
    });

    new cdk.CfnOutput(this, 'UiBucketName', {
      value: this.uiBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.consoleDistribution.distributionId,
    });

    new cdk.CfnOutput(this, 'WakeApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'POST /work (also used by the UI in cloud mode)',
    });

    new cdk.CfnOutput(this, 'WorkQueueUrl', {
      value: this.queue.queueUrl,
    });

    new cdk.CfnOutput(this, 'RuntimeInstanceId', {
      value: this.instance.instanceId,
    });

    new cdk.CfnOutput(this, 'RuntimePublicIp', {
      value: this.elasticIp.ref,
      description: 'Stable Elastic IP for the runtime host',
    });

    new cdk.CfnOutput(this, 'RuntimeEcrUri', {
      value: this.runtimeRepo.repositoryUri,
    });

    new cdk.CfnOutput(this, 'BridgeEcrUri', {
      value: this.bridgeRepo.repositoryUri,
    });

    new cdk.CfnOutput(this, 'ApiAuthSecretArn', {
      value: apiAuthSecret.secretArn,
      description: 'Bearer token for POST /work',
    });

    new cdk.CfnOutput(this, 'RuntimeEnvSecretArn', {
      value: runtimeEnvSecret.secretArn,
      description: 'Set ANTHROPIC_API_KEY and other runtime env vars here',
    });

    new cdk.CfnOutput(this, 'GitHubWebhookSecretArn', {
      value: githubWebhookSecret.secretArn,
    });
  }
}
