#!/usr/bin/env node
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { parseRagCliArgs, ragDebug } from "../rag/cli-args.js";
import { collectInspectOutput } from "../rag/inspect-stats.js";
import { formatInspectText } from "../rag/query-output.js";

async function run(): Promise<void> {
  applyCosRuntimeEnv();
  const started = Date.now();
  const { format } = parseRagCliArgs(process.argv);

  await initSchema();
  ragDebug(`schema ready (${Date.now() - started}ms)`);

  const output = await collectInspectOutput();
  ragDebug(
    `counts sources=${output.ragSources} chunks=${output.ragChunks} embedded=${output.ragChunksEmbedded} links=${output.ragLinks}`,
  );

  if (format === "text") {
    console.log(formatInspectText(output));
  } else {
    console.log(JSON.stringify(output));
  }
}

run().catch((err) => {
  console.error("[inspect] fatal:", err);
  process.exit(1);
});
