#!/usr/bin/env node
/**
 * CI-only fixture demo. Requires COS_ALLOW_FIXTURES=true.
 * Vitest may set COS_MOCK_* inside test files only.
 */
import "dotenv/config";
import { initSchema } from "../graph/graph.db.js";
import { getNodeCount } from "../graph/upsert.js";
import { runConnectors } from "../graph/ingest-runner.js";
import { initLangSmith, flushLangSmith } from "../observability/langsmith.js";
import { identityId } from "../graph/canonical-id.js";
import { chunkAllNodes } from "../rag/chunk.js";
import { backendEmbedPending } from "../rag/backend.js";
import { buildFixtureConnectors } from "../connectors/build-connectors.js";
import { generateNotifications } from "../notifications/generator.js";
import { generateSuggestion } from "../suggestions/generator.js";
import { writeConversationTurn, getConversationHistory } from "../history/store.js";
import { allowsFixtures } from "../config/env.js";

async function run(): Promise<void> {
  if (!allowsFixtures()) {
    console.error("[demo-fixtures] Set COS_ALLOW_FIXTURES=true (CI only).");
    process.exit(1);
  }

  process.env["COS_USE_FIXTURES"] = "true";
  process.env["COS_MOCK_EMBED"] = "true";
  process.env["COS_MOCK_LLM"] = "true";

  initLangSmith();

  console.log("\n=== BigBoss — Fixture Demo (CI only) ===\n");

  await initSchema();

  const ownerId = identityId("demo@prismteam.ai");
  const connectors = buildFixtureConnectors(ownerId);

  console.log("Step 1/5: Ingesting fixture data…");
  const stats = await runConnectors(connectors);
  const total = await getNodeCount();
  console.log(`  ✅ ${stats.written} nodes written (${total} total)\n`);

  console.log("Step 2/5: RAG (mock embed)…");
  await chunkAllNodes(ownerId);
  await backendEmbedPending(ownerId);
  console.log("  ✅ chunked + embedded\n");

  console.log("Step 3/5: Notifications…");
  const notifResult = await generateNotifications(ownerId);
  console.log(`  ✅ ${notifResult.generated.length} notification(s)\n`);

  console.log("Step 4/5: Suggestion…");
  const replyNeeded = notifResult.generated.find((n) => n.triggerType === "reply-needed");
  const suggestTargetId = replyNeeded?.sourceNodeIds[0];
  if (suggestTargetId) {
    await generateSuggestion(ownerId, suggestTargetId);
    console.log("  ✅ suggestion generated\n");
  }

  console.log("Step 5/5: History…");
  const sessionId = `demo-session-${Date.now()}`;
  await writeConversationTurn({ sessionId, turnIndex: 0, role: "user", content: "@bigboss brief me" });
  await writeConversationTurn({ sessionId, turnIndex: 1, role: "assistant", content: "Brief complete." });
  const history = await getConversationHistory({ sessionId });
  console.log(`  ✅ ${history.length} turns\n`);

  console.log("=== Fixture demo complete ===\n");
  await flushLangSmith();
}

run().catch((err) => {
  console.error("[demo-fixtures] fatal:", err);
  process.exit(1);
});
