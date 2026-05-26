#!/usr/bin/env node
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { identityId } from "../graph/canonical-id.js";
import { getEnv } from "../config/env.js";
import { parseRagCliArgs, ragDebug } from "../rag/cli-args.js";
import { formatPathsText } from "../rag/query-output.js";
import { findRelatedSources } from "../rag/paths.js";

const DEFAULT_PATHS_TOP_K = 10;

async function run(): Promise<void> {
  applyCosRuntimeEnv();
  await initSchema();

  const { positional, format, topK } = parseRagCliArgs(process.argv);
  const queryText = positional.join(" ").trim();
  if (!queryText) {
    console.error('Usage: pnpm paths -- "<criteria>" [--top-k N] [--format text|json]');
    console.error('       pnpm paths -- --file ./criteria.txt');
    process.exit(1);
  }

  const env = getEnv();
  const ownerEmail = env.COS_OWNER_EMAIL ?? "demo@prismteam.ai";
  const ownerUserId = identityId(ownerEmail);

  const output = await findRelatedSources(
    queryText,
    { ownerUserId },
    topK ?? DEFAULT_PATHS_TOP_K,
  );

  ragDebug(`suggestions=${output.suggestions.length} for query length=${queryText.length}`);

  if (format === "text") {
    console.log(formatPathsText(output));
  } else {
    console.log(JSON.stringify(output));
  }
}

run().catch((err) => {
  console.error("[paths] fatal:", err);
  process.exit(1);
});
