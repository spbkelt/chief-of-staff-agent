/** Allow COS_MOCK_* flags inside Vitest only (not product paths). */
process.env["COS_ALLOW_FIXTURES"] = "true";

/**
 * Force local backends in all unit/integration tests so the test suite is
 * self-contained and never routes to real AWS (DynamoDB / OpenSearch) even
 * when COS_GRAPH_BACKEND=dynamo or COS_RAG_BACKEND=opensearch are set in
 * the developer's shell (production environment variables).
 */
process.env["COS_GRAPH_BACKEND"] = "libsql";
process.env["COS_RAG_BACKEND"] = "local";
