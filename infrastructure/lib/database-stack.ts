import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  environment: string;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { environment, vpc, securityGroup } = props;

    this.secret = new secretsmanager.Secret(this, 'DBSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'artificer' }),
        generateStringKey: 'password',
        excludeCharacters: '/@" ',
        passwordLength: 32,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const subnetGroup = new rds.SubnetGroup(this, 'DBSubnetGroup', {
      description: 'Subnet group for Artificer Aurora cluster',
      subnetGroupName: `artificer-${environment}-db-subnet-group`,
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      clusterIdentifier: `artificer-${environment}-aurora`,
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(this.secret, 'artificer'),
      defaultDatabaseName: 'artificer',
      subnetGroup: subnetGroup,
      vpc: vpc,
      securityGroups: [securityGroup],
      writer: rds.ClusterInstance.serverlessV2('WriterInstance'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      storageEncrypted: true,
      backup: {
        retention: cdk.Duration.days(7),
        preferredWindow: '03:00-04:00',
      },
    });

    new cdk.CfnOutput(this, 'DBClusterArn', {
      value: this.cluster.clusterArn,
      exportName: `artificer-${environment}-db-cluster-arn`,
    });

    new cdk.CfnOutput(this, 'DBClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      exportName: `artificer-${environment}-db-endpoint`,
    });

    new cdk.CfnOutput(this, 'DBClusterReaderEndpoint', {
      value: this.cluster.clusterReadEndpoint.hostname,
      exportName: `artificer-${environment}-db-reader-endpoint`,
    });

    new cdk.CfnOutput(this, 'DBSecretArn', {
      value: this.secret.secretArn,
      exportName: `artificer-${environment}-db-secret-arn`,
    });
  }
}
