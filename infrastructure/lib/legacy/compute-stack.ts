import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  environment: string;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { environment, vpc, securityGroup } = props;

    this.cluster = new ecs.Cluster(this, 'ArtificerCluster', {
      clusterName: `artificer-${environment}-cluster`,
      vpc: vpc,
      containerInsights: true,
    });

    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: `artificer-${environment}-task-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'ArtificerTaskDef',
      {
        taskRole: taskExecutionRole,
        executionRole: taskExecutionRole,
        cpu: 512,
        memoryLimitMiB: 1024,
      },
    );

    const container = taskDefinition.addContainer('artificer-web', {
      image: ecs.ContainerImage.fromAsset('../packages/orchestrator', {
        exclude: ['node_modules', '.turbo', 'dist'],
      }),
      environment: {
        NODE_ENV: environment === 'prod' ? 'production' : 'development',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'artificer-web',
        logRetention: 7,
      }),
    });

    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    this.service = new ecs.FargateService(this, 'ArtificerService', {
      serviceName: `artificer-${environment}-web`,
      cluster: this.cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      exportName: `artificer-${environment}-ecs-cluster-name`,
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.serviceName,
      exportName: `artificer-${environment}-ecs-service-name`,
    });
  }
}
