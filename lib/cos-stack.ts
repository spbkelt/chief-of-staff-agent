import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface CosStackProps extends cdk.StackProps {
  stage?: string;
}

/**
 * Chief of Staff AWS infrastructure:
 *   - DynamoDB: single-table knowledge graph (pk=canonicalId, sk=nodeType)
 *   - OpenSearch Serverless: knn vector search for RAG (1024-dim Cohere embeddings)
 *   - Lambda: scheduled notification push handler
 *   - EventBridge: cron rule every 15 minutes
 */
export class CosStack extends cdk.Stack {
  readonly graphTable: dynamodb.TableV2;
  readonly opensearchCollection: opensearchserverless.CfnCollection;
  readonly notificationPushFn: lambda.Function;

  constructor(scope: Construct, id: string, props: CosStackProps = {}) {
    super(scope, id, props);

    const stage = props.stage ?? "dev";

    // --- DynamoDB: single-table knowledge graph ---
    this.graphTable = new dynamodb.TableV2(this, "CosGraphTable", {
      tableName: `cos-graph-${stage}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: "ownerUserId-nodeType-index",
          partitionKey: { name: "ownerUserId", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "nodeType", type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    // --- OpenSearch Serverless: vector collection ---
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, "VectorEncryption", {
      name: `cos-vectors-enc-${stage}`,
      type: "encryption",
      policy: JSON.stringify({
        Rules: [{ ResourceType: "collection", Resource: [`collection/cos-vectors-${stage}`] }],
        AWSOwnedKey: true,
      }),
    });

    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, "VectorNetwork", {
      name: `cos-vectors-net-${stage}`,
      type: "network",
      policy: JSON.stringify([
        {
          Rules: [
            { ResourceType: "collection", Resource: [`collection/cos-vectors-${stage}`] },
            { ResourceType: "dashboard", Resource: [`collection/cos-vectors-${stage}`] },
          ],
          AllowFromPublic: false,
        },
      ]),
    });

    this.opensearchCollection = new opensearchserverless.CfnCollection(this, "VectorCollection", {
      name: `cos-vectors-${stage}`,
      type: "VECTORSEARCH",
    });
    this.opensearchCollection.addDependency(encryptionPolicy);
    this.opensearchCollection.addDependency(networkPolicy);

    // --- Lambda: notification push handler ---
    this.notificationPushFn = new NodejsFunction(this, "NotificationPushFn", {
      functionName: `cos-notification-push-${stage}`,
      entry: "apps/cos-runtime/src/lambda/notification-push.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        COS_GRAPH_BACKEND: "dynamo",
        COS_DYNAMO_TABLE: this.graphTable.tableName,
        COS_OPENSEARCH_ENDPOINT: this.opensearchCollection.attrCollectionEndpoint,
        AWS_REGION_NAME: this.region,
      },
    });

    this.graphTable.grantReadWriteData(this.notificationPushFn);

    this.notificationPushFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["aoss:APIAccessAll"],
        resources: [this.opensearchCollection.attrArn],
      }),
    );

    // --- EventBridge: every 15 minutes ---
    const rule = new events.Rule(this, "NotificationPushSchedule", {
      ruleName: `cos-notification-push-${stage}`,
      schedule: events.Schedule.cron({ minute: "0/15" }),
    });
    rule.addTarget(new targets.LambdaFunction(this.notificationPushFn));

    // --- Outputs ---
    new cdk.CfnOutput(this, "GraphTableName", { value: this.graphTable.tableName });
    new cdk.CfnOutput(this, "OpenSearchEndpoint", { value: this.opensearchCollection.attrCollectionEndpoint });
    new cdk.CfnOutput(this, "NotificationPushFnArn", { value: this.notificationPushFn.functionArn });
  }
}
