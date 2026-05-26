#!/usr/bin/env node
/**
 * Product demo — single scripted E2E pass (real APIs, ~/.cos/config.json).
 *
 *   pnpm demo
 *   pnpm demo -- --skip-ingest
 *   pnpm demo -- --query "overdue Asana tasks"
 */
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { getNodeCount } from "../graph/upsert.js";
import { runConnectors } from "../graph/ingest-runner.js";
import { initLangSmith, flushLangSmith } from "../observability/langsmith.js";
import { getEnv, assertProductNoMocks } from "../config/env.js";
import { identityId } from "../graph/canonical-id.js";
import { chunkAllNodes } from "../rag/chunk.js";
import { backendEmbedPending } from "../rag/backend.js";
import { backendRetrieve } from "../rag/backend.js";
import { buildRealConnectors } from "../connectors/build-connectors.js";
import { generateNotifications } from "../notifications/generator.js";
import { generateSuggestion } from "../suggestions/generator.js";
import { writeConversationTurn, getConversationHistory } from "../history/store.js";
import {
  resolveNotificationAdapters,
  deliverNotificationToChannels,
} from "../notifications/delivery/resolve-adapters.js";
import { readCosConfig, summarizeCosConfig } from "../config/credentials.js";
import { usesLocalHashEmbeddings, usesOpenSearchRag } from "../rag/embed-mode.js";
import { collectInspectOutput } from "../rag/inspect-stats.js";
import { formatInspectText, formatQueryText, retrievalToQueryOutput } from "../rag/query-output.js";
import { DEFAULT_TOP_K } from "../rag/retrieve.js";
import { printBrief } from "./brief.js";
import { DEMO_USAGE, parseDemoArgv } from "./demo-parse.js";

const MAX_DEMO_NOTIFICATIONS = 3;

function stepBanner(n: number, total: number, title: string): void {
  console.log(`\n── Step ${n}/${total}: ${title} ──\n`);
}

function printPreflight(): void {
  console.log("Configuration (no secrets):");
  for (const s of summarizeCosConfig()) {
    const mark = s.configured ? "✅" : "○";
    console.log(`  ${mark} ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
  }
  const graph = process.env["COS_GRAPH_BACKEND"] ?? "libsql";
  const rag = process.env["COS_RAG_BACKEND"] ?? "local";
  const embedMode = usesLocalHashEmbeddings()
    ? "local-hash"
    : usesOpenSearchRag()
      ? "Bedrock/OpenAI → OpenSearch"
      : "libSQL vectors";
  console.log(`\nRuntime: graph=${graph} rag=${rag} embed=${embedMode}`);
  const config = readCosConfig();
  const telegram =
    config.telegram?.botToken && config.telegram?.chatId ? "telegram + console" : "console only";
  console.log(`Notify delivery: ${telegram}\n`);
}

async function run(): Promise<void> {
  const { skipIngest, queryText } = parseDemoArgv(process.argv.slice(2));
  if (queryText === "__HELP__") {
    console.log(DEMO_USAGE);
    return;
  }

  applyCosRuntimeEnv();
  assertProductNoMocks("demo");
  initLangSmith();

  const totalSteps = skipIngest ? 6 : 7;
  let step = 0;

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║     BigBoss COS — Live Demo (scripted)      ║");
  console.log("╚═══════════════════════════════════════════╝");

  printPreflight();

  await initSchema();

  const env = getEnv();
  if (!env.COS_OWNER_EMAIL) {
    console.error("[demo] COS_OWNER_EMAIL not set. Run `pnpm setup` (section 1) first.");
    process.exit(1);
  }

  const ownerEmail = env.COS_OWNER_EMAIL;
  const ownerId = identityId(ownerEmail);
  const cosConfig = readCosConfig();

  if (!skipIngest) {
    stepBanner(++step, totalSteps, "Ingest (Google Calendar, Gmail, Asana)");
    const connectors = await buildRealConnectors({ ownerUserId: ownerId, ownerEmail });
    const stats = await runConnectors(connectors);
    console.log(
      `  ✅ ${stats.total} events, ${stats.written} written, ${stats.skipped} skipped (dedup)`,
    );
    console.log(`  ✅ graph nodes: ${await getNodeCount()}`);
  } else {
    console.log("\n  ⏭  Ingest skipped (--skip-ingest)\n");
  }

  stepBanner(++step, totalSteps, "RAG (chunk + embed + OpenSearch index when configured)");
  if (usesOpenSearchRag() && !usesLocalHashEmbeddings()) {
    console.log(
      "  ℹ️  Cloud embeddings: each chunk calls Bedrock (slow). For a fast demo:\n" +
        "      export COS_OPENSEARCH_USE_LOCAL_EMBED=true\n",
    );
  }

  console.log("  … chunking graph nodes");
  const chunkStats = await chunkAllNodes(ownerId);
  console.log(`  ✅ chunked ${chunkStats.chunked} node(s) (${chunkStats.skipped} unchanged)`);

  const embedMaxRaw = process.env["COS_DEMO_EMBED_MAX"];
  const embedMax =
    embedMaxRaw === undefined
      ? usesLocalHashEmbeddings()
        ? undefined
        : 40
      : embedMaxRaw === "0"
        ? undefined
        : Number(embedMaxRaw);

  const logEmbedProgress = (done: number, total: number): void => {
    if (done === 1 || done % 10 === 0 || done === total) {
      process.stdout.write(`\r  … embedded ${done}/${total} chunk(s)`);
      if (done === total) process.stdout.write("\n");
    }
  };

  if (embedMax !== undefined && embedMax > 0) {
    console.log(`  … embedding up to ${embedMax} pending chunk(s) (COS_DEMO_EMBED_MAX; 0 = no limit)`);
  } else {
    console.log("  … embedding pending chunks");
  }

  const embedStats = await backendEmbedPending(ownerId, {
    ...(embedMax !== undefined ? { maxChunks: embedMax } : {}),
    onProgress: logEmbedProgress,
  });

  if (embedStats.pending > embedStats.embedded + embedStats.skipped && embedMax !== undefined) {
    const remaining = embedStats.pending - embedStats.embedded - embedStats.skipped;
    console.log(
      `  ℹ️  ${remaining} chunk(s) still pending — run \`pnpm embed\` (or \`COS_DEMO_EMBED_MAX=0 pnpm demo\`)`,
    );
  }

  console.log(
    `  ✅ embedded ${embedStats.embedded} chunk(s)` +
      (embedStats.skipped > 0 ? ` (${embedStats.skipped} failed)` : ""),
  );
  if (embedStats.pending > 0 && embedStats.embedded === 0 && embedStats.lastError) {
    console.warn(`  ⚠️  embed: ${embedStats.lastError}`);
  }

  stepBanner(++step, totalSteps, "Query (RAG retrieval)");
  console.log(`  Q: ${queryText}`);
  const retrieval = await backendRetrieve(queryText, { ownerUserId: ownerId }, DEFAULT_TOP_K);
  const queryOut = retrievalToQueryOutput(queryText, retrieval);
  console.log(formatQueryText(queryOut));
  if (queryOut.belowThreshold) {
    console.log(
      "  ℹ️  Top score below confidence threshold — expected with local-hash demo embed; notify/brief still work.",
    );
  }

  stepBanner(++step, totalSteps, "Notifications (generate + deliver)");
  const adapters = await resolveNotificationAdapters(cosConfig);
  const notifResult = await generateNotifications(ownerId);
  console.log(`  ✅ generated ${notifResult.generated.length} notification(s)`);
  if (notifResult.skippedDedup > 0) {
    console.log(`  ℹ️  ${notifResult.skippedDedup} skipped (60-min dedup window)`);
  }

  const toDeliver = notifResult.generated.slice(0, MAX_DEMO_NOTIFICATIONS);
  for (let i = 0; i < toDeliver.length; i++) {
    const n = toDeliver[i]!;
    console.log(
      `\n  ${i + 1}. [${n.triggerType}] ${n.title} (score=${n.priorityScore.toFixed(2)})`,
    );
    await deliverNotificationToChannels(n, ownerId, adapters);
  }
  if (notifResult.generated.length > MAX_DEMO_NOTIFICATIONS) {
    console.log(
      `\n  ℹ️  Delivered first ${MAX_DEMO_NOTIFICATIONS}; run \`pnpm notify\` for full list.`,
    );
  }

  stepBanner(++step, totalSteps, "Suggestion (draft, never auto-sends)");
  const suggestTarget =
    notifResult.generated.find((n) => n.triggerType === "reply-needed")?.sourceNodeIds[0] ??
    notifResult.generated[0]?.sourceNodeIds[0];
  if (suggestTarget) {
    const suggestion = await generateSuggestion(ownerId, suggestTarget);
    console.log(`  ✅ ${suggestion.canonicalId} status=${suggestion.status}`);
    console.log(`  ℹ️  Approve with: pnpm approve -- ${suggestion.canonicalId}`);
  } else {
    console.log("  ℹ️  No notification source available for suggestion");
  }

  stepBanner(++step, totalSteps, "Brief (today) + conversation history");
  await printBrief(ownerId, "today");
  const sessionId = `demo-${Date.now()}`;
  await writeConversationTurn({
    sessionId,
    turnIndex: 0,
    role: "user",
    content: "@bigboss demo",
  });
  await writeConversationTurn({
    sessionId,
    turnIndex: 1,
    role: "assistant",
    content: `Demo complete. Query: ${queryText.slice(0, 120)}`,
  });
  console.log(`  ✅ history session ${sessionId} (${(await getConversationHistory({ sessionId })).length} turns)`);

  stepBanner(++step, totalSteps, "Summary");
  const inspect = await collectInspectOutput();
  console.log(formatInspectText(inspect));

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║           Demo complete — all steps        ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  await flushLangSmith();

  if (embedStats.pending > 0 && embedStats.embedded === 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
