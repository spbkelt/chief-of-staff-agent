#!/usr/bin/env node
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { initLangSmith, flushLangSmith } from "../observability/langsmith.js";
import { identityId } from "../graph/canonical-id.js";
import { getEnv } from "../config/env.js";
import { backendRetrieve } from "../rag/backend.js";
import { DEFAULT_TOP_K } from "../rag/retrieve.js";
import { parseRagCliArgs, ragDebug } from "../rag/cli-args.js";
import { retrievalToQueryOutput, formatQueryText } from "../rag/query-output.js";
import { embedQuery } from "../rag/embed.js";

async function run(): Promise<void> {
  applyCosRuntimeEnv();
  initLangSmith();
  await initSchema();

  const { positional, format } = parseRagCliArgs(process.argv);
  const queryText = positional.join(" ").trim();
  if (!queryText) {
    console.error('Usage: pnpm query -- "<your question>" [--format text|json]');
    process.exit(1);
  }

  const env = getEnv();
  const ownerEmail = env.COS_OWNER_EMAIL ?? "demo@prismteam.ai";
  const ownerUserId = identityId(ownerEmail);

  const { model } = await embedQuery(queryText);
  ragDebug(`embed model=${model} ownerUserId=${ownerUserId.slice(0, 8)}…`);

  const result = await backendRetrieve(queryText, { ownerUserId }, DEFAULT_TOP_K);
  ragDebug(
    `matches=${result.chunks.length} belowThreshold=${result.belowThreshold} bestRaw=${result.chunks[0]?.rawScore?.toFixed(3) ?? "n/a"}`,
  );

  const output = retrievalToQueryOutput(queryText, result);

  if (format === "text") {
    console.log(formatQueryText(output));
  } else {
    console.log(JSON.stringify(output));
  }

  await flushLangSmith();
}

run().catch((err) => {
  console.error("[query] fatal:", err);
  process.exit(1);
});
