import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';

interface DataStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dataSecurityGroup: ec2.SecurityGroup;
  elasticacheSubnetGroup: elasticache.CfnSubnetGroup;
}

export class DataStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly cache: elasticache.CfnCacheCluster;
  public readonly db: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const db = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_2
      }),
      instanceType: new ec2.InstanceType('t3.micro'),
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({subnetGroupName: 'data'}),
      databaseName: 'platform',
      credentials: rds.Credentials.fromGeneratedSecret('literalai'),
      deletionProtection: true,
      allocatedStorage: 100,
      securityGroups: [props.dataSecurityGroup]
    });

    // Elasticache
    const cache = new elasticache.CfnCacheCluster(this, 'Cache', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: props.elasticacheSubnetGroup.ref,
      vpcSecurityGroupIds: [props.dataSecurityGroup.securityGroupId]
    });

    // S3
    const bucket = new s3.Bucket(this, 'Bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST],
          allowedHeaders: ['*'],
        }
      ],
    });

    this.bucket = bucket;
    this.cache = cache;
    this.db = db;
  }
}
