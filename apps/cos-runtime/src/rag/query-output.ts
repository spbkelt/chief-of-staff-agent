import { z } from "zod";
import type { RetrievalResult, RetrievedChunk } from "./retrieve.js";
import { MIN_CONFIDENT_SCORE } from "./retrieve.js";

const SNIPPET_MAX = 200;

export const QueryMatchSchema = z.object({
  chunkId: z.string(),
  sourceNodeId: z.string(),
  sourceType: z.string(),
  title: z.string(),
  score: z.number(),
  rawScore: z.number(),
  citation: z.string(),
  snippet: z.string(),
});

export const QueryOutputSchema = z.object({
  query: z.string(),
  belowThreshold: z.boolean(),
  minConfidentScore: z.number(),
  matches: z.array(QueryMatchSchema),
  retrievedChunkIds: z.array(z.string()),
});

export type QueryOutput = z.infer<typeof QueryOutputSchema>;

export const InspectOutputSchema = z.object({
  graphNodes: z.number(),
  graphNodesByType: z.record(z.string(), z.number()),
  ragSources: z.number(),
  ragChunks: z.number(),
  ragChunksEmbedded: z.number(),
  ragLinks: z.number(),
});

export type InspectOutput = z.infer<typeof InspectOutputSchema>;

export const PathSuggestionSchema = z.object({
  canonicalId: z.string(),
  nodeType: z.string(),
  title: z.string(),
  url: z.string(),
  relation: z.string(),
  score: z.number(),
  seedChunkId: z.string().optional(),
});

export const PathsOutputSchema = z.object({
  query: z.string(),
  suggestions: z.array(PathSuggestionSchema),
});

export type PathsOutput = z.infer<typeof PathsOutputSchema>;
export type PathSuggestion = z.infer<typeof PathSuggestionSchema>;

export function chunkToSnippet(text: string, max = SNIPPET_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function retrievalToQueryOutput(query: string, result: RetrievalResult): QueryOutput {
  const matches = result.chunks.map((c: RetrievedChunk) => ({
    chunkId: c.chunkId,
    sourceNodeId: c.sourceNodeId,
    sourceType: c.sourceType,
    title: c.title,
    score: c.score,
    rawScore: c.rawScore,
    citation: c.citation,
    snippet: chunkToSnippet(c.chunkText),
  }));

  return {
    query,
    belowThreshold: result.belowThreshold,
    minConfidentScore: MIN_CONFIDENT_SCORE,
    matches,
    retrievedChunkIds: result.retrievedChunkIds,
  };
}

export function formatQueryText(output: QueryOutput): string {
  const lines: string[] = [`Query: ${output.query}`, ""];

  if (output.matches.length === 0) {
    lines.push("No results found. Run `pnpm demo` or `pnpm ingest` to populate the knowledge graph.");
    return lines.join("\n");
  }

  if (output.belowThreshold) {
    const best = output.matches[0]?.rawScore ?? 0;
    lines.push(
      "I don't have enough context in the knowledge graph to answer this confidently.",
      `(Best match score: ${best.toFixed(3)} — minimum required: ${output.minConfidentScore})`,
      "",
      "Currently ingested data:",
    );
    for (const m of output.matches.slice(0, 3)) {
      lines.push(`  • [${m.sourceType}] ${m.title} (score: ${m.rawScore.toFixed(3)})`);
    }
    return lines.join("\n");
  }

  lines.push(`Top ${output.matches.length} results:`, "");
  for (let i = 0; i < output.matches.length; i++) {
    const m = output.matches[i]!;
    lines.push(`[${i + 1}] ${m.title} (${m.sourceType})`);
    lines.push(`    Score: ${m.score.toFixed(3)} (raw: ${m.rawScore.toFixed(3)})`);
    lines.push(`    ${m.snippet}`);
    lines.push(`    Citation: ${m.citation}`);
    lines.push("");
  }
  lines.push(`Retrieved chunk IDs: ${output.retrievedChunkIds.join(", ")}`);
  return lines.join("\n");
}

export function formatInspectText(output: InspectOutput): string {
  const lines: string[] = [`Total nodes: ${output.graphNodes}`];
  const entries = Object.entries(output.graphNodesByType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of entries) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push(
    `RAG sources: ${output.ragSources}`,
    `RAG chunks: ${output.ragChunks} total, ${output.ragChunksEmbedded} embedded`,
    `RAG links: ${output.ragLinks}`,
  );
  return lines.join("\n");
}

export function formatPathsText(output: PathsOutput): string {
  const lines: string[] = [`Query: ${output.query}`, ""];
  if (output.suggestions.length === 0) {
    lines.push("No related executive sources found for this query.");
    lines.push("Run `pnpm ingest` first or try a narrower query.");
    return lines.join("\n");
  }
  lines.push(`Related sources (${output.suggestions.length}):`, "");
  for (let i = 0; i < output.suggestions.length; i++) {
    const s = output.suggestions[i]!;
    lines.push(`[${i + 1}] ${s.title} (${s.nodeType}) — ${s.relation}`);
    lines.push(`    ${s.url}`);
    lines.push(`    ${s.canonicalId}`);
    lines.push("");
  }
  return lines.join("\n");
}
