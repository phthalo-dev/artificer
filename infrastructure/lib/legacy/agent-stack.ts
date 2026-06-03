import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Construct } from 'constructs';

export interface AgentStackProps extends cdk.StackProps {
  environment: string;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
  agentRole: iam.Role;
  logBucket: s3.Bucket;
}

export class AgentStack extends cdk.Stack {
  public readonly launchTemplate: ec2.LaunchTemplate;
  public readonly instanceProfile: iam.CfnInstanceProfile;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const { environment, vpc, securityGroup, agentRole, logBucket } = props;

    const userDataScript = readFileSync(
      join(__dirname, '../user-data/agent-setup.sh'),
      'utf8',
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(userDataScript);

    this.launchTemplate = new ec2.LaunchTemplate(
      this,
      'ArtificerAgentLaunchTemplate',
      {
        launchTemplateName: `artificer-${environment}-agent`,
        machineImage: ec2.MachineImage.fromSsmParameter(
          '/aws/service/canonical/ubuntu/server/jammy/stable/current/amd64/hvm/ebs-gp2/ami-id',
        ),
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.MEDIUM,
        ),
        keyName: undefined,
        securityGroup: securityGroup,
        role: agentRole,
        userData: userData,
        blockDevices: [
          {
            deviceName: '/dev/sda1',
            volume: ec2.BlockDeviceVolume.ebs(50, {
              encrypted: true,
              volumeType: ec2.EbsDeviceVolumeType.GP3,
            }),
          },
        ],
      },
    );

    this.instanceProfile = new iam.CfnInstanceProfile(
      this,
      'AgentInstanceProfile',
      {
        instanceProfileName: `artificer-${environment}-agent-profile`,
        roles: [agentRole.roleName],
      },
    );

    new cdk.CfnOutput(this, 'LaunchTemplateId', {
      value: this.launchTemplate.launchTemplateId!,
      exportName: `artificer-${environment}-agent-launch-template-id`,
    });

    new cdk.CfnOutput(this, 'LaunchTemplateVersion', {
      value: this.launchTemplate.latestVersionNumber,
      exportName: `artificer-${environment}-agent-launch-template-version`,
    });
  }
}
