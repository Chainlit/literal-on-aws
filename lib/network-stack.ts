import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { ApplicationLoadBalancer, ApplicationListener } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly elasticacheSubnetGroup: elasticache.CfnSubnetGroup;

  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly dataSecurityGroup: ec2.SecurityGroup;

  public readonly alb: ApplicationLoadBalancer;
  public readonly listener: ApplicationListener;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('172.31.0.0/16'),
      maxAzs: 3,
      natGateways: 0,
      flowLogs: {
        VPC: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL
        }
      },
      subnetConfiguration: [
        {
          cidrMask: 20,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 20,
          name: 'application',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 20,
          name: 'data',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const elasticacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'ElasticacheSubnetGroup', {
      subnetIds: vpc.selectSubnets({subnetGroupName: 'data'}).subnetIds,
      description: 'Subnet group for redis',
    })
    

    // ALB security group
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      securityGroupName: 'AlbSecurityGroup',
    });

    albSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'HTTP');

    // ECS security group
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      securityGroupName: 'EcsSecurityGroup',
    });

    ecsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(3000), 'ECS');

    // Data security group
    const dataSecurityGroup = new ec2.SecurityGroup(this, 'DataSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      securityGroupName: 'DataSecurityGroup',
    });

    dataSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(5432), 'Postgres');
    dataSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(6379), 'Redis');
    dataSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(6380), 'Redis');

    // Application Load Balancer
    const alb = new ApplicationLoadBalancer(this, 'ALB', {
      loadBalancerName: id.toLowerCase(),
      vpc,
      internetFacing: true,
      vpcSubnets: vpc.selectSubnets({subnetGroupName: 'public'}),
      securityGroup: albSecurityGroup,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
    });

    // Export
    this.vpc = vpc;
    this.elasticacheSubnetGroup = elasticacheSubnetGroup;

    this.albSecurityGroup = albSecurityGroup;
    this.ecsSecurityGroup = ecsSecurityGroup;
    this.dataSecurityGroup = dataSecurityGroup;

    this.alb = alb;
    this.listener = listener;
  }
}
