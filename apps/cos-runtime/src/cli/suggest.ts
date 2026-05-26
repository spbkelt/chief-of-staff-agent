#!/usr/bin/env node
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { identityId } from "../graph/canonical-id.js";
import { getEnv } from "../config/env.js";
import { generateSuggestion } from "../suggestions/generator.js";
import { backendGetNode } from "../graph/backend.js";

async function run(): Promise<void> {
  // pnpm suggest -- <nodeId> may leave a leading "--" token (same as query.ts)
  const targetNodeId = process.argv.slice(2).find((a) => a !== "--");
  if (!targetNodeId) {
    console.error("Usage: pnpm suggest -- <nodeId>");
    console.error("       pnpm suggest -- <thread-canonicalId>");
    process.exit(1);
  }

  applyCosRuntimeEnv();
  await initSchema();

  const env = getEnv();
  if (!env.COS_OWNER_EMAIL) {
    console.error("[suggest] COS_OWNER_EMAIL is not set. Run `pnpm validate` to check credentials.");
    process.exit(1);
  }

  const ownerUserId = identityId(env.COS_OWNER_EMAIL);

  console.log("\n=== BigBoss COS — Response Suggestion ===\n");
  console.log(`Target: ${targetNodeId}`);

  const targetNode = await backendGetNode(targetNodeId);
  if (!targetNode) {
    console.error(`[suggest] Node not found: ${targetNodeId}`);
    console.error("Run `pnpm ingest` first to populate the knowledge graph, or check the node ID.");
    process.exit(1);
  }

  const suggestion = await generateSuggestion(ownerUserId, targetNodeId);

  const { recordActivity } = await import("../history/record-activity.js");
  await recordActivity("suggestion.created", suggestion.canonicalId, ownerUserId);

  console.log(`\nResponse type:  ${suggestion.responseType}`);
  console.log(`Status:         ${suggestion.status} (requires explicit approval)`);
  console.log(`Suggestion ID:  ${suggestion.canonicalId}`);
  console.log(`\nDraft text:\n${suggestion.draftText}`);
  console.log(`\nTone:           ${suggestion.toneAssessment}`);
  console.log(`\nFactual basis:`);
  for (const f of suggestion.factualBasis) console.log(`  - ${f}`);
  if (suggestion.assumptions.length > 0) {
    console.log(`\nAssumptions:`);
    for (const a of suggestion.assumptions) console.log(`  - ${a}`);
  }
  console.log(`\nCited sources:  ${suggestion.citedSourceNodeIds.join(", ")}`);
  console.log(`\nTo approve: pnpm approve -- ${suggestion.canonicalId} --approve`);
  console.log(`To reject:  pnpm approve -- ${suggestion.canonicalId} --reject\n`);
}

run().catch((err) => {
  console.error("[suggest] fatal:", err);
  process.exit(1);
});
