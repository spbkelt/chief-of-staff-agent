#!/usr/bin/env node
/**
 * Embed pending rag_chunks only (no connector pull). Useful after switching to local RAG.
 */
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { getDb } from "../graph/graph.db.js";
import { getEnv } from "../config/env.js";
import { identityId } from "../graph/canonical-id.js";
import { backendEmbedPending } from "../rag/backend.js";
import { usesLocalHashEmbeddings } from "../rag/embed-mode.js";
import { flushLangSmith, initLangSmith } from "../observability/langsmith.js";

async function run(): Promise<void> {
  applyCosRuntimeEnv();
  initLangSmith();
  await initSchema();

  const env = getEnv();
  const ownerEmail = env.COS_OWNER_EMAIL;
  if (!ownerEmail) {
    console.error("[embed] COS_OWNER_EMAIL not set. Run pnpm setup first.");
    process.exit(1);
  }

  const ownerId = identityId(ownerEmail);
  const reindex = process.argv.includes("--reindex");

  if (reindex) {
    const db = getDb();
    await db.execute({
      sql: `UPDATE rag_chunks SET embedding = NULL, embedding_model = NULL, embedding_dims = NULL
            WHERE owner_user_id = ?`,
      args: [ownerId],
    });
    console.log("[embed] Cleared existing embeddings (--reindex)");
  }

  const mode = usesLocalHashEmbeddings() ? "local-hash (libSQL)" : "cloud (Bedrock/OpenSearch)";
  console.log(`[embed] mode: ${mode}`);

  const stats = await backendEmbedPending(ownerId);
  console.log(
    `[embed] pending=${stats.pending} embedded=${stats.embedded} skipped=${stats.skipped}`
  );

  if (stats.skipped > 0) process.exit(1);
  await flushLangSmith();
}

run().catch((err) => {
  console.error("[embed] fatal:", err);
  process.exit(1);
});
