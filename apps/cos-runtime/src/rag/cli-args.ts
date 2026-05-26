/**
 * Shared CLI flag parsing for RAG commands (inspect, query, paths).
 */

import fs from "fs";

export type OutputFormat = "json" | "text";

export interface RagCliArgs {
  positional: string[];
  format: OutputFormat;
  topK?: number;
}

export function isRagDebug(): boolean {
  return process.env["RAG_DEBUG"] === "true" || process.env["RAG_DEBUG"] === "1";
}

export function ragDebug(message: string): void {
  if (isRagDebug()) {
    process.stderr.write(`[rag-debug] ${message}\n`);
  }
}

export function parseRagCliArgs(argv: string[]): RagCliArgs {
  const args = argv.slice(2).filter((a) => a !== "--");
  let format: OutputFormat = "json";
  let topK: number | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--format" && args[i + 1]) {
      const f = args[++i]!;
      if (f === "text" || f === "json") format = f;
      continue;
    }
    if (a.startsWith("--format=")) {
      const f = a.slice("--format=".length);
      if (f === "text" || f === "json") format = f;
      continue;
    }
    if (a === "--top-k" && args[i + 1]) {
      topK = parseInt(args[++i]!, 10);
      continue;
    }
    if (a.startsWith("--top-k=")) {
      topK = parseInt(a.slice("--top-k=".length), 10);
      continue;
    }
    if (a === "--file" && args[i + 1]) {
      const content = fs.readFileSync(args[++i]!, "utf8").trim();
      if (content) positional.push(content);
      continue;
    }
    if (!a.startsWith("--")) {
      positional.push(a);
    }
  }

  return topK !== undefined ? { positional, format, topK } : { positional, format };
}
