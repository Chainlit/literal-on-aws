#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { EcsStack } from '../lib/ecs-stack';
import { DataStack } from '../lib/data-stack';

const app = new cdk.App();

const networkStack = new NetworkStack(app, 'NetworkStack', {});

const dataStack = new DataStack(app, 'DataStack', {
  vpc: networkStack.vpc,
  dataSecurityGroup: networkStack.dataSecurityGroup,
  elasticacheSubnetGroup: networkStack.elasticacheSubnetGroup,
});

new EcsStack(app, 'EcsStack', {
  vpc: networkStack.vpc,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  alb: networkStack.alb,
  bucket: dataStack.bucket,
  cache: dataStack.cache,
  db: dataStack.db,
  listener: networkStack.listener,
});
