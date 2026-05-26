#!/usr/bin/env node
/**
 * Migrate local libSQL RAG to AWS: Bedrock embeddings + OpenSearch retrieval.
 *
 * Prerequisites:
 *   aws sso login --profile <cos-default>
 *   ./scripts/bootstrap-aws-cos.sh --profile cos-default --write-config
 *   Attach CosBigBossOperator-dev policy to your SSO role (printed by bootstrap)
 */
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { getEnv } from "../config/env.js";
import { identityId } from "../graph/canonical-id.js";
import { readCosConfig } from "../config/credentials.js";
import { checkAwsRagReadiness } from "../rag/aws-rag-check.js";
import { backfillRagLinks } from "../rag/backfill-links.js";
import { backendEmbedPending } from "../rag/backend.js";
import { getDb } from "../graph/graph.db.js";
import { usesOpenSearchRag } from "../rag/embed-mode.js";
import { flushLangSmith, initLangSmith } from "../observability/langsmith.js";

async function clearEmbeddings(ownerUserId: string): Promise<number> {
  const db = getDb();
  const result = await db.execute({
    sql: `UPDATE rag_chunks SET embedding = NULL, embedding_model = NULL, embedding_dims = NULL
          WHERE owner_user_id = ?`,
    args: [ownerUserId],
  });
  return Number(result.rowsAffected ?? 0);
}

async function run(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const skipLinks = process.argv.includes("--skip-links");
  const skipEmbed = process.argv.includes("--skip-embed");

  applyCosRuntimeEnv();
  initLangSmith();

  const config = readCosConfig();
  console.log("\n=== BigBoss COS — Migrate to AWS RAG (Bedrock + OpenSearch) ===\n");
  console.log(`  LLM:          ${config.llm?.provider ?? "n/a"} (${config.llm?.auth ?? "n/a"})`);
  console.log(`  RAG backend:  ${config.llm?.ragBackend ?? "local"}`);
  console.log(`  OpenSearch:   ${config.llm?.opensearchEndpoint ?? "not set"}`);
  console.log(`  Graph:        ${config.llm?.graphBackend ?? "libsql"}`);
  console.log("");

  const readiness = await checkAwsRagReadiness(true);
  for (const err of readiness.errors) {
    console.error(`  ❌ ${err}`);
  }

  if (!readiness.bedrockConfigured || !readiness.opensearchConfigured) {
    console.error("\nFix configuration, then re-run: pnpm migrate-aws-rag\n");
    process.exit(1);
  }

  if (!readiness.bedrockReachable || !readiness.opensearchReachable) {
    console.error("\nAWS/OpenSearch not reachable. Login and attach operator policy, then retry.\n");
    process.exit(1);
  }

  if (!usesOpenSearchRag()) {
    console.error("COS_RAG_BACKEND is not opensearch after applyCosRuntimeEnv. Check ~/.cos/config.json llm.ragBackend");
    process.exit(1);
  }

  if (dryRun) {
    console.log("✅ Dry run — configuration and AWS pings OK. Re-run without --dry-run to migrate.\n");
    return;
  }

  await initSchema();
  const env = getEnv();
  if (!env.COS_OWNER_EMAIL) {
    console.error("[migrate-aws-rag] COS_OWNER_EMAIL not set. Run pnpm setup.");
    process.exit(1);
  }
  const ownerUserId = identityId(env.COS_OWNER_EMAIL);

  if (!skipLinks) {
    console.log("[migrate-aws-rag] Backfilling rag_links…");
    const links = await backfillRagLinks(ownerUserId);
    console.log(`  links=${links.linksWritten} chunks=${links.chunksProcessed}`);
  }

  if (!skipEmbed) {
    console.log("[migrate-aws-rag] Clearing local-hash embeddings…");
    const cleared = await clearEmbeddings(ownerUserId);
    console.log(`  cleared=${cleared}`);

    console.log("[migrate-aws-rag] Re-embedding with Bedrock + indexing OpenSearch…");
    const stats = await backendEmbedPending(ownerUserId);
    console.log(
      `  pending=${stats.pending} embedded=${stats.embedded} skipped=${stats.skipped}` +
        (stats.lastError ? ` lastError=${stats.lastError}` : ""),
    );
    if (stats.embedded === 0 && stats.pending > 0) {
      console.error("[migrate-aws-rag] No chunks embedded — check Bedrock model access and quotas.");
      process.exit(1);
    }
  }

  console.log("\n✅ AWS RAG migration complete.");
  console.log("   Verify: pnpm query -- \"overdue COS-SEED\" | jq .belowThreshold, .matches[0].rawScore");
  console.log("   Inspect: pnpm inspect | jq .ragChunksEmbedded, .ragLinks\n");

  await flushLangSmith();
}

run().catch((err) => {
  console.error("[migrate-aws-rag] fatal:", err);
  process.exit(1);
});
