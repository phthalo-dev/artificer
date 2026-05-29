import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CoreStackProps extends cdk.StackProps {
  environment: string;
}

export class CoreStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly controlPlaneSecurityGroup: ec2.SecurityGroup;
  public readonly agentSecurityGroup: ec2.SecurityGroup;
  public readonly agentLogBucket: s3.Bucket;
  public readonly agentEc2Role: iam.Role;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    const { environment } = props;

    this.vpc = new ec2.Vpc(this, 'ArtificerVPC', {
      vpcName: `artificer-${environment}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      natGateways: 1,
      natGatewayProvider: ec2.NatProvider.gateway(),
    });

    this.controlPlaneSecurityGroup = new ec2.SecurityGroup(
      this,
      'ControlPlaneSecurityGroup',
      {
        securityGroupName: `artificer-${environment}-control-plane`,
        vpc: this.vpc,
        description: 'Security group for Artificer control plane (ECS/Fargate)',
        allowAllOutbound: true,
      },
    );

    this.agentSecurityGroup = new ec2.SecurityGroup(
      this,
      'AgentSecurityGroup',
      {
        securityGroupName: `artificer-${environment}-agent`,
        vpc: this.vpc,
        description: 'Security group for Artificer agents (EC2)',
        allowAllOutbound: true,
      },
    );

    this.agentSecurityGroup.addIngressRule(
      this.controlPlaneSecurityGroup,
      ec2.Port.tcp(4096),
      'Allow OpenCode access from control plane',
    );

    this.agentSecurityGroup.addIngressRule(
      this.controlPlaneSecurityGroup,
      ec2.Port.tcp(22),
      'Allow SSH access from control plane',
    );

    const logGroup = new logs.LogGroup(this, 'AgentLogGroup', {
      logGroupName: `/aws/ec2/artificer-agent/${environment}`,
      retention: logs.RetentionDays.INFINITE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.agentLogBucket = new s3.Bucket(this, 'AgentLogBucket', {
      bucketName: `artificer-${environment}-agent-logs-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'ExpireOldLogs',
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    this.agentEc2Role = new iam.Role(this, 'AgentEC2Role', {
      roleName: `artificer-${environment}-agent-ec2`,
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'CloudWatchAgentServerPolicy',
        ),
      ],
    });

    this.agentLogBucket.grantWrite(this.agentEc2Role, '*');
    logGroup.grantWrite(this.agentEc2Role);

    new cdk.CfnOutput(this, 'VPCId', {
      value: this.vpc.vpcId,
      exportName: `artificer-${environment}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.privateSubnets
        .map((subnet: ec2.ISubnet) => subnet.subnetId)
        .join(','),
      exportName: `artificer-${environment}-private-subnet-ids`,
    });

    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.vpc.publicSubnets
        .map((subnet: ec2.ISubnet) => subnet.subnetId)
        .join(','),
      exportName: `artificer-${environment}-public-subnet-ids`,
    });

    new cdk.CfnOutput(this, 'ControlPlaneSecurityGroupId', {
      value: this.controlPlaneSecurityGroup.securityGroupId,
      exportName: `artificer-${environment}-control-plane-sg`,
    });

    new cdk.CfnOutput(this, 'AgentSecurityGroupId', {
      value: this.agentSecurityGroup.securityGroupId,
      exportName: `artificer-${environment}-agent-sg`,
    });

    new cdk.CfnOutput(this, 'AgentLogBucketName', {
      value: this.agentLogBucket.bucketName,
      exportName: `artificer-${environment}-agent-log-bucket`,
    });
  }
}
