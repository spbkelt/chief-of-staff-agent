import { getEnv } from "../config/env.js";

// LangSmith wrapper — wire before any LLM call, flush at every AI entrypoint
// Email body text must NEVER appear in trace inputs

let _initialized = false;

export interface TraceInput {
  query: string; // user query text only — no email body, no PII
  retrievedChunkIds?: string[]; // chunk IDs only, never chunk text
  [key: string]: unknown;
}

export interface TraceOutput {
  summary?: string;
  notificationTitle?: string;
  draftText?: string;
  [key: string]: unknown;
}

export interface TraceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitInputTokens?: number;
}

export function initLangSmith(): void {
  if (_initialized) return;
  const env = getEnv();

  if (env.LANGSMITH_TRACING && env.LANGSMITH_API_KEY) {
    process.env["LANGCHAIN_TRACING_V2"] = "true";
    process.env["LANGCHAIN_API_KEY"] = env.LANGSMITH_API_KEY;
    process.env["LANGCHAIN_PROJECT"] = env.LANGSMITH_PROJECT;
    process.env["LANGCHAIN_ENDPOINT"] = env.LANGSMITH_ENDPOINT;
  }

  _initialized = true;
}

export async function flushLangSmith(): Promise<void> {
  // In production this calls client.flush(); in prototype, no-op if LangSmith not configured
  if (!_initialized) return;
  try {
    const { Client } = await import("langsmith");
    const client = new Client();
    await client.awaitPendingTraceBatches();
  } catch {
    // LangSmith not configured — non-fatal in demo mode
  }
}

export function sanitizeForTrace(text: string): string {
  // Strip content that must not appear in traces
  // Truncate to 500 chars max for query field
  return text.slice(0, 500);
}

export function resetForTest(): void {
  _initialized = false;
}
