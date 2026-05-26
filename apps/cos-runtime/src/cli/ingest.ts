#!/usr/bin/env node
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { runConnectors } from "../graph/ingest-runner.js";
import { initLangSmith, flushLangSmith } from "../observability/langsmith.js";
import { getEnv, allowsFixtures } from "../config/env.js";
import { identityId } from "../graph/canonical-id.js";
import { buildRealConnectors, buildFixtureConnectors } from "../connectors/build-connectors.js";
import type { Connector } from "../connectors/connector.interface.js";
import {
  formatIngestWindow,
  INGEST_CLI_USAGE,
  parseIngestArgv,
} from "../config/ingest-window.js";

async function run(): Promise<void> {
  applyCosRuntimeEnv();
  initLangSmith();

  let ingestArgs: ReturnType<typeof parseIngestArgv>;
  try {
    ingestArgs = parseIngestArgv(process.argv.slice(2));
  } catch (err) {
    console.error(`[ingest] ${err instanceof Error ? err.message : String(err)}`);
    console.error(INGEST_CLI_USAGE);
    process.exit(1);
  }

  const { window: ingestWindow, connectorFilter } = ingestArgs;
  const useFixtures = allowsFixtures() && process.env["COS_USE_FIXTURES"] === "true";

  await initSchema();

  const env = getEnv();
  const ownerEmail = env.COS_OWNER_EMAIL ?? "owner@example.com";
  const ownerId = identityId(ownerEmail);

  console.log(`[ingest] window: ${formatIngestWindow(ingestWindow)}`);
  console.log(
    `[ingest] backends: graph=${process.env["COS_GRAPH_BACKEND"] ?? "libsql"}, rag=${process.env["COS_RAG_BACKEND"] ?? "local-hash"}`,
  );

  let connectors: Connector[];

  if (useFixtures) {
    connectors = buildFixtureConnectors(ownerId, connectorFilter);
    console.log("[ingest] Fixture mode (CI only — COS_ALLOW_FIXTURES + COS_USE_FIXTURES)");
  } else {
    connectors = await buildRealConnectors({
      ownerUserId: ownerId,
      ownerEmail,
      ingestWindow,
      ...(connectorFilter ? { connectorFilter } : {}),
    });
  }

  if (connectors.length === 0) {
    console.warn("[ingest] No connectors matched filter — nothing to do");
    await flushLangSmith();
    return;
  }

  const stats = await runConnectors(connectors);

  console.log(
    `[ingest] complete — ${stats.total} events processed, ${stats.written} written, ${stats.skipped} skipped (dedup)`
  );

  const { recordActivity } = await import("../history/record-activity.js");
  for (const connector of connectors) {
    await recordActivity("ingest.completed", connector.config.connectorId, ownerId, connector.config.connectorId);
  }

  const { chunkAllNodes } = await import("../rag/chunk.js");
  const { backendEmbedPending } = await import("../rag/backend.js");
  const chunkStats = await chunkAllNodes(ownerId);
  console.log(`[ingest] chunked ${chunkStats.chunked} nodes into RAG sources`);
  const embedStats = await backendEmbedPending(ownerId);
  const skipNote = embedStats.skipped > 0 ? `, ${embedStats.skipped} failed` : "";
  const pendingNote =
    embedStats.pending > 0 && embedStats.embedded === 0
      ? " — check [embed] warnings above"
      : "";
  console.log(`[ingest] embedded ${embedStats.embedded} chunks${skipNote}${pendingNote}`);

  await flushLangSmith();
}

run().catch((err) => {
  console.error("[ingest] fatal:", err);
  process.exit(1);
});
