import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBulkResult = { body: { errors: false, items: [] } };
const mockSearchResult = {
  body: {
    hits: {
      hits: [
        {
          _id: "chunk-001",
          _score: 0.92,
          _source: {
            chunkText: "sample text",
            sourceNodeId: "node-abc",
            ownerUserId: "user-1",
            embeddingModel: "cohere.embed-v4:0",
            nodeType: "Chunk",
            createdAt: "2026-01-01T00:00:00.000Z",
            canonicalId: "chunk-001",
            embedding: [],
          },
        },
      ],
    },
  },
};

const mockClient = {
  indices: {
    exists: vi.fn(async () => ({ statusCode: 404 })),
    create: vi.fn(async () => ({})),
  },
  bulk: vi.fn(async () => mockBulkResult),
  search: vi.fn(async () => mockSearchResult),
};

vi.mock("@opensearch-project/opensearch", () => ({
  Client: vi.fn(() => mockClient),
}));

vi.mock("@opensearch-project/opensearch/aws", () => ({
  AwsSigv4Signer: vi.fn(() => ({})),
}));

vi.mock("../../config/aws-credentials.js", () => ({
  getAwsCredentials: vi.fn(async () => async () => ({ accessKeyId: "test", secretAccessKey: "test" })),
  getAwsRegion: vi.fn(() => "us-east-2"),
}));

vi.mock("../../config/credentials.js", () => ({
  readCosConfig: vi.fn(() => ({
    llm: { provider: "bedrock", opensearchEndpoint: "https://test.aoss.amazonaws.com" },
  })),
}));

describe("opensearch-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockClient.indices.exists).mockResolvedValue({ statusCode: 404 } as never);
    mockBulkResult.body.errors = false;
    // Reset module cache so _client singleton is reset
    vi.resetModules();
  });

  it("indexChunks sends bulk request to OpenSearch", async () => {
    vi.mocked(mockClient.indices.exists).mockResolvedValue({ statusCode: 200 } as never);
    const { indexChunks } = await import("../../rag/opensearch-store.js");
    await indexChunks([
      {
        canonicalId: "chunk-001",
        ownerUserId: "user-1",
        chunkText: "sample text",
        embedding: new Array(1024).fill(0.1),
        nodeType: "Chunk",
        sourceNodeId: "node-abc",
        embeddingModel: "cohere.embed-v4:0",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(mockClient.bulk).toHaveBeenCalled();
    const calls = mockClient.bulk.mock.calls as unknown as Array<[{ body: unknown[] }]>;
    // deleteChunksByCanonicalIds fires a delete bulk call first (when index exists and hit found),
    // then indexChunks fires the index bulk call — check the last call for the index operation.
    const body = calls[calls.length - 1]![0].body;
    expect(body.length).toBe(2); // action + doc
    expect(body[0]).toEqual({ index: { _index: "cos-chunks" } });
    expect((body[1] as { canonicalId: string }).canonicalId).toBe("chunk-001");
  });

  it("indexChunks is a no-op for empty array", async () => {
    const { indexChunks } = await import("../../rag/opensearch-store.js");
    await indexChunks([]);
    expect(mockClient.bulk).not.toHaveBeenCalled();
  });

  it("searchChunks returns mapped hits with ownerUserId filter", async () => {
    const { searchChunks } = await import("../../rag/opensearch-store.js");
    const results = await searchChunks(new Array(1024).fill(0.1), "user-1", 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.canonicalId).toBe("chunk-001");
    expect(results[0]!.chunkText).toBe("sample text");
    expect(results[0]!.sourceNodeId).toBe("node-abc");
    expect(results[0]!.score).toBe(0.92);

    const searchCalls = mockClient.search.mock.calls as unknown as Array<[{ body: { query: { bool: { filter: Array<{ term: { ownerUserId: string } }> } } } }]>;
    const searchBody = searchCalls[0]![0].body;
    expect(searchBody.query.bool.filter[0]!.term.ownerUserId).toBe("user-1");
  });

  it("ensureIndex creates index when it does not exist", async () => {
    const { ensureIndex } = await import("../../rag/opensearch-store.js");
    await ensureIndex();
    expect(mockClient.indices.create).toHaveBeenCalledOnce();
  });

  it("indexChunks throws on bulk errors", async () => {
    mockBulkResult.body.errors = true;
    const { indexChunks } = await import("../../rag/opensearch-store.js");
    await expect(
      indexChunks([
        {
          canonicalId: "c1",
          ownerUserId: "u1",
          chunkText: "t",
          embedding: [],
          nodeType: "Chunk",
          sourceNodeId: "n1",
          embeddingModel: "m",
          createdAt: new Date().toISOString(),
        },
      ])
    ).rejects.toThrow("OpenSearch bulk index failed");
  });
});
