import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationListener,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as s3 from "aws-cdk-lib/aws-s3";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  ecsSecurityGroup: ec2.SecurityGroup;
  alb: ApplicationLoadBalancer;
  bucket: s3.Bucket;
  cache: elasticache.CfnCacheCluster;
  db: rds.DatabaseInstance;
  listener: ApplicationListener;
}

export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const literalDockerPat = new cdk.CfnParameter(this, "dockerPat", {
      type: "String",
      description: "Dockerhub token for Literalai",
    }).valueAsString;

    // Secrets
    const secret = new Secret(this, "LiteralaiDockerhub", {
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({
          username: "literalai",
          password: literalDockerPat,
        })
      ),
    });

    const nextAuthSecret = new Secret(this, "NextAuthSecret", {
      generateSecretString: {
        excludePunctuation: true,
      },
    });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc: props.vpc });

    const task = new ecs.FargateTaskDefinition(this, "task", {
      memoryLimitMiB: 2048,
      cpu: 1024,
    });

    task.addToTaskRolePolicy(
      new PolicyStatement({
        actions: ["s3:*"],
        resources: [props.bucket.bucketArn + "/*"],
      })
    );

    task.addToExecutionRolePolicy(
      new PolicyStatement({
        actions: ["s3:*"],
        resources: ["*"],
      })
    );

    const service = new ecs.FargateService(this, "Service", {
      cluster: cluster,
      assignPublicIp: true,
      vpcSubnets: props.vpc.selectSubnets({ subnetGroupName: "application" }),
      taskDefinition: task,
      desiredCount: 1,
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE",
          weight: 1,
        },
      ],
      enableExecuteCommand: true,
      securityGroups: [props.ecsSecurityGroup],
      circuitBreaker: {
        rollback: true,
      },
    });

    const logging = new ecs.AwsLogDriver({ streamPrefix: "service" });

    const dbSecret = Secret.fromSecretNameV2(
      this,
      "DBSecret",
      props.db.secret?.secretName || ""
    );

    const backend = task.addContainer("backend", {
      image: ecs.ContainerImage.fromRegistry(
        "docker.io/literalai/platform:latest",
        {
          credentials: secret,
        }
      ),
      portMappings: [
        {
          containerPort: 3000,
        },
      ],
      logging,
      environment: {
        REDIS_URL: `redis://${props.cache.attrRedisEndpointAddress}:${props.cache.attrRedisEndpointPort}`,
        DATABASE_SSL: "true",
        BUCKET_NAME: props.bucket.bucketName,
        NEXTAUTH_URL: `http://${props.alb.loadBalancerDnsName}`,
      },
      environmentFiles: [
        ecs.EnvironmentFile.fromAsset("./literal.container.env"),
      ],
      secrets: {
        DATABASE_HOST: ecs.Secret.fromSecretsManager(dbSecret, "host"),
        DATABASE_PORT: ecs.Secret.fromSecretsManager(dbSecret, "port"),
        DATABASE_NAME: ecs.Secret.fromSecretsManager(dbSecret, "dbname"),
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, "username"),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
        NEXTAUTH_SECRET: ecs.Secret.fromSecretsManager(nextAuthSecret),
      },
    });

    props.listener.addTargets("Service", {
      port: 3000,
      protocol: ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/",
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
      },
    });

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: `http://${props.alb.loadBalancerDnsName}`,
    });
  }
}
