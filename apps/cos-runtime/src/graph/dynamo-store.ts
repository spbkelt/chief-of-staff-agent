import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { getAwsCredentials, getAwsRegion } from "../config/aws-credentials.js";
import { readCosConfig } from "../config/credentials.js";
import type { KnowledgeNode } from "./schema.js";
import type { UpsertResult } from "./upsert.js";

const DEFAULT_TABLE = "cos-graph";

function getTableName(): string {
  const config = readCosConfig();
  return config.llm?.dynamoTable ?? process.env["COS_DYNAMO_TABLE"] ?? DEFAULT_TABLE;
}

let _client: DynamoDBDocumentClient | undefined;

async function getClient(): Promise<DynamoDBDocumentClient> {
  if (_client) return _client;
  const credentials = await getAwsCredentials();
  const base = new DynamoDBClient({ region: getAwsRegion(), credentials });
  _client = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return _client;
}

function extractRawHash(node: KnowledgeNode): string {
  if ("rawHash" in node) return node.rawHash as string;
  return "";
}

export async function dynamoUpsertNode(node: KnowledgeNode): Promise<UpsertResult> {
  const client = await getClient();
  const table = getTableName();
  const now = new Date().toISOString();
  const rawHash = extractRawHash(node);

  if (rawHash) {
    const existing = await client.send(new GetCommand({
      TableName: table,
      Key: { pk: node.canonicalId, sk: node.nodeType },
      ProjectionExpression: "rawHash",
    }));
    if (existing.Item?.["rawHash"] === rawHash) {
      return { canonicalId: node.canonicalId, skipped: true };
    }
  }

  await client.send(new PutCommand({
    TableName: table,
    Item: {
      pk: node.canonicalId,
      sk: node.nodeType,
      ownerUserId: ("ownerUserId" in node ? node.ownerUserId : undefined) ?? "system",
      nodeType: node.nodeType,
      data: JSON.stringify(node),
      createdAt: now,
      updatedAt: now,
      ...(rawHash ? { rawHash } : {}),
    },
  }));

  return { canonicalId: node.canonicalId, skipped: false };
}

export async function dynamoGetNode(canonicalId: string, nodeType: string): Promise<KnowledgeNode | null> {
  if (nodeType) {
    const client = await getClient();
    const result = await client.send(new GetCommand({
      TableName: getTableName(),
      Key: { pk: canonicalId, sk: nodeType },
    }));
    if (!result.Item?.["data"]) return null;
    return JSON.parse(result.Item["data"] as string) as KnowledgeNode;
  }
  return dynamoGetNodeByPk(canonicalId);
}

/** Lookup when only canonicalId is known (e.g. OpenSearch hit → parent node). */
export async function dynamoGetNodeByPk(canonicalId: string): Promise<KnowledgeNode | null> {
  const client = await getClient();
  const result = await client.send(new QueryCommand({
    TableName: getTableName(),
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": canonicalId },
    Limit: 1,
  }));
  const item = result.Items?.[0];
  if (!item?.["data"]) return null;
  return JSON.parse(item["data"] as string) as KnowledgeNode;
}

export async function dynamoQueryNodesByType(ownerUserId: string, nodeType: string): Promise<KnowledgeNode[]> {
  const client = await getClient();
  const nodes: KnowledgeNode[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await client.send(new QueryCommand({
      TableName: getTableName(),
      IndexName: "ownerUserId-nodeType-index",
      KeyConditionExpression: "ownerUserId = :owner AND nodeType = :type",
      ExpressionAttributeValues: { ":owner": ownerUserId, ":type": nodeType },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    for (const item of result.Items ?? []) {
      if (!item["data"]) continue;
      nodes.push(JSON.parse(item["data"] as string) as KnowledgeNode);
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return nodes;
}

export async function dynamoDeleteNode(canonicalId: string, nodeType: string): Promise<void> {
  const client = await getClient();
  await client.send(new DeleteCommand({
    TableName: getTableName(),
    Key: { pk: canonicalId, sk: nodeType },
  }));
}
