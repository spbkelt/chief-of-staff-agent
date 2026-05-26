import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import { getAwsCredentials, getAwsRegion } from "../config/aws-credentials.js";
import { readCosConfig } from "../config/credentials.js";

const INDEX_NAME = "cos-chunks";
const VECTOR_DIMS = 1024;

interface ChunkDoc {
  canonicalId: string;
  ownerUserId: string;
  chunkText: string;
  embedding: number[];
  nodeType: string;
  sourceNodeId: string;
  embeddingModel: string;
  createdAt: string;
}

let _client: Client | undefined;

/** AOSS returns 404 when the index is missing; the JS client throws unless ignored. */
async function indexExists(client: Client): Promise<boolean> {
  const res = await client.indices.exists({ index: INDEX_NAME }, { ignore: [404] });
  return res.statusCode === 200;
}

async function getClient(): Promise<Client> {
  if (_client) return _client;
  const config = readCosConfig();
  const endpoint = config.llm?.opensearchEndpoint ?? process.env["COS_OPENSEARCH_ENDPOINT"];
  if (!endpoint) throw new Error("OpenSearch endpoint not configured. Set COS_OPENSEARCH_ENDPOINT or run `pnpm setup`.");

  const credentials = await getAwsCredentials();
  const region = getAwsRegion();

  _client = new Client({
    ...AwsSigv4Signer({
      region,
      service: "aoss",
      getCredentials: credentials,
    }),
    node: endpoint,
  });
  return _client;
}

export async function ensureIndex(): Promise<void> {
  const client = await getClient();
  if (await indexExists(client)) return;

  await client.indices.create({
    index: INDEX_NAME,
    body: {
      mappings: {
        properties: {
          canonicalId: { type: "keyword" },
          ownerUserId: { type: "keyword" },
          chunkText: { type: "text" },
          embedding: { type: "knn_vector", dimension: VECTOR_DIMS },
          nodeType: { type: "keyword" },
          sourceNodeId: { type: "keyword" },
          embeddingModel: { type: "keyword" },
          createdAt: { type: "date" },
        },
      },
      settings: {
        "index.knn": true,
      },
    },
  });
}

/** AOSS does not support delete-by-query; delete by auto-generated _id after lookup. */
async function deleteChunksByCanonicalIds(canonicalIds: string[]): Promise<void> {
  if (canonicalIds.length === 0) return;
  const client = await getClient();
  if (!(await indexExists(client))) return;

  const search = await client.search(
    {
      index: INDEX_NAME,
      body: {
        size: Math.min(canonicalIds.length, 500),
        query: { terms: { canonicalId: canonicalIds } },
        _source: false,
      },
    },
    { ignore: [404] },
  );
  if (search.statusCode === 404) return;

  const hits = search.body.hits.hits as unknown as Array<{ _id: string }>;
  if (hits.length === 0) return;

  const body = hits.map((hit) => ({ delete: { _index: INDEX_NAME, _id: hit._id } }));
  const result = await client.bulk({ body });
  if (result.body.errors) {
    const failures = (result.body.items as unknown as Array<{ delete: { error?: unknown } }>)
      .filter((i) => i.delete?.error)
      .map((i) => JSON.stringify(i.delete.error))
      .slice(0, 3);
    throw new Error(`OpenSearch bulk delete failed: ${failures.join("; ")}`);
  }
}

const BULK_BATCH = 50;

export async function indexChunks(
  chunks: ChunkDoc[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (chunks.length === 0) return;
  const client = await getClient();
  await ensureIndex();

  const canonicalIds = chunks.map((c) => c.canonicalId);
  await deleteChunksByCanonicalIds(canonicalIds);

  for (let offset = 0; offset < chunks.length; offset += BULK_BATCH) {
    const batch = chunks.slice(offset, offset + BULK_BATCH);
    const body = batch.flatMap((chunk) => [{ index: { _index: INDEX_NAME } }, chunk]);

    const result = await client.bulk({ body });
    if (result.body.errors) {
      const failures = (result.body.items as unknown as Array<{ index: { error?: unknown } }>)
        .filter((i) => i.index.error)
        .map((i) => JSON.stringify(i.index.error))
        .slice(0, 3);
      throw new Error(`OpenSearch bulk index failed: ${failures.join("; ")}`);
    }
    onProgress?.(Math.min(offset + batch.length, chunks.length), chunks.length);
  }
}

export async function searchChunks(
  queryVector: number[],
  ownerUserId: string,
  topK = 8,
): Promise<Array<{ canonicalId: string; chunkText: string; sourceNodeId: string; score: number }>> {
  const client = await getClient();

  const result = await client.search({
    index: INDEX_NAME,
    body: {
      size: topK,
      query: {
        bool: {
          must: [
            {
              knn: {
                embedding: { vector: queryVector, k: topK },
              },
            },
          ],
          filter: [{ term: { ownerUserId } }],
        },
      },
    },
  });

  return (result.body.hits.hits as unknown as Array<{ _id: string; _score: number; _source: ChunkDoc }>).map(
    (hit) => ({
      canonicalId: hit._source.canonicalId || hit._id,
      chunkText: hit._source.chunkText,
      sourceNodeId: hit._source.sourceNodeId,
      score: hit._score,
    }),
  );
}
