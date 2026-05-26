import { getDb } from "../graph/graph.db.js";
import { backendGetNodesByType, backendUpsertNode, backendUpsertEdge } from "../graph/backend.js";
import { derivedNodeId } from "../graph/canonical-id.js";
import type {
  CalendarEventNode,
  EmailMessageNode,
  AsanaTaskNode,
  AsanaCommentNode,
  AsanaProjectNode,
} from "../graph/schema.js";

// Token approximation: 1 token ≈ 4 chars
const CHARS_PER_TOKEN = 4;

// Per-type chunking limits from SKILL.md strategy table
const EMAIL_MAX_TOKENS = 512;
const EMAIL_OVERLAP_TOKENS = 64;
const MEETING_MAX_TOKENS = 256;
const TASK_MAX_TOKENS = 512;
const TASK_OVERLAP_TOKENS = 64;
const PROJECT_MAX_TOKENS = 256;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Deterministic IDs — must stay stable across re-runs
export function chunkCanonicalId(parentNodeId: string, index: number): string {
  return derivedNodeId("SourceArtifact", `${parentNodeId}:${index}`);
}

function sourceCanonicalId(parentNodeId: string): string {
  return derivedNodeId("rag-source", parentNodeId);
}

/** Sentence-window chunking with overlap */
export function sentenceWindowChunks(text: string, maxTokens: number, overlapTokens: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) ?? [text];
  const chunks: string[] = [];
  let window: string[] = [];
  let windowTokens = 0;

  for (const sentence of sentences) {
    const st = approxTokens(sentence);
    if (windowTokens + st > maxTokens && window.length > 0) {
      chunks.push(window.join(" ").trim());
      // Retain trailing sentences up to overlap budget
      const kept: string[] = [];
      let keptTokens = 0;
      for (let i = window.length - 1; i >= 0; i--) {
        const s = window[i]!;
        const t = approxTokens(s);
        if (keptTokens + t > overlapTokens) break;
        kept.unshift(s);
        keptTokens += t;
      }
      window = kept;
      windowTokens = keptTokens;
    }
    window.push(sentence);
    windowTokens += st;
  }
  if (window.length > 0) chunks.push(window.join(" ").trim());
  return chunks.filter((c) => c.length > 0);
}

async function isAlreadyChunked(sourceNodeId: string, currentRawHash: string): Promise<boolean> {
  const db = getDb();
  const row = await db.execute({
    sql: "SELECT raw_hash FROM rag_sources WHERE source_node_id = ?",
    args: [sourceNodeId],
  });
  if (row.rows.length === 0) return false;
  return row.rows[0]?.[0] === currentRawHash;
}

async function writeSourceAndChunks(
  parentNodeId: string,
  sourceType: string,
  title: string,
  ownerUserId: string,
  rawHashValue: string,
  chunks: string[],
): Promise<void> {
  const db = getDb();
  const srcId = sourceCanonicalId(parentNodeId);
  const now = new Date().toISOString();

  // Upsert rag_source — update raw_hash so future runs detect changes
  await db.execute({
    sql: `INSERT INTO rag_sources (canonical_id, source_node_id, source_type, title, owner_user_id, raw_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (canonical_id) DO UPDATE SET raw_hash = excluded.raw_hash`,
    args: [srcId, parentNodeId, sourceType, title, ownerUserId, rawHashValue, now],
  });

  // Delete old chunks when rawHash changed (re-chunk scenario)
  await db.execute({ sql: "DELETE FROM rag_chunks WHERE source_id = ?", args: [srcId] });
  const { deleteLinksForSource, writeChunkOfLinks } = await import("./links.js");
  await deleteLinksForSource(srcId);

  const chunkIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i]!;
    const chunkId = chunkCanonicalId(parentNodeId, i);
    chunkIds.push(chunkId);
    const tokenCount = approxTokens(text);

    await db.execute({
      sql: `INSERT INTO rag_chunks (canonical_id, source_id, chunk_index, chunk_text, embedding, embedding_model, embedding_dims, token_count, owner_user_id, created_at)
            VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
            ON CONFLICT (canonical_id) DO NOTHING`,
      args: [chunkId, srcId, i, text, tokenCount, ownerUserId, now],
    });

    // Lightweight SourceArtifact in nodes table — embedding stays null here; rag_chunks holds the real embedding
    await backendUpsertNode({
      nodeType: "SourceArtifact",
      canonicalId: chunkId,
      sourceNodeId: parentNodeId,
      ownerUserId,
      chunkIndex: i,
      chunkText: text,
      embedding: null,
      embeddingModel: "",
      embeddingDimensions: 0,
      tokenCount,
      createdAt: now,
    });

    // CHUNK_OF edge: chunk → parent node
    await backendUpsertEdge({
      id: `${chunkId}:CHUNK_OF:${parentNodeId}`,
      edgeType: "CHUNK_OF",
      fromId: chunkId,
      toId: parentNodeId,
      createdAt: now,
    });
  }

  await writeChunkOfLinks(parentNodeId, chunkIds);
}

export interface ChunkResult {
  chunked: number;
  skipped: number;
}

export async function chunkAllNodes(ownerUserId: string): Promise<ChunkResult> {
  let chunked = 0;
  let skipped = 0;

  // EmailMessage — sentence-window 512t / 64t overlap
  const emails = (await backendGetNodesByType(ownerUserId, "EmailMessage")) as unknown as EmailMessageNode[];
  for (const msg of emails) {
    if (await isAlreadyChunked(msg.canonicalId, msg.rawHash)) { skipped++; continue; }

    const text = [msg.subject, msg.bodyText].filter(Boolean).join("\n");
    if (!text.trim()) { skipped++; continue; }

    const chunks = approxTokens(text) <= EMAIL_MAX_TOKENS
      ? [text]
      : sentenceWindowChunks(text, EMAIL_MAX_TOKENS, EMAIL_OVERLAP_TOKENS);

    await writeSourceAndChunks(msg.canonicalId, "EmailMessage", msg.subject, ownerUserId, msg.rawHash, chunks);
    chunked++;
  }

  // CalendarEvent — meeting context chunk (max 256t)
  const events = (await backendGetNodesByType(ownerUserId, "CalendarEvent")) as unknown as CalendarEventNode[];
  for (const evt of events) {
    if (await isAlreadyChunked(evt.canonicalId, evt.rawHash)) { skipped++; continue; }

    const parts = [
      evt.title,
      evt.description ?? "",
      `Start: ${evt.startAt}`,
      `End: ${evt.endAt}`,
      evt.location ? `Location: ${evt.location}` : "",
    ].filter(Boolean);
    const text = parts.join("\n");

    const chunks = approxTokens(text) <= MEETING_MAX_TOKENS
      ? [text]
      : sentenceWindowChunks(text, MEETING_MAX_TOKENS, 0);

    await writeSourceAndChunks(evt.canonicalId, "CalendarEvent", evt.title, ownerUserId, evt.rawHash, chunks);
    chunked++;
  }

  // AsanaTask + comments — append, chunk at 512t
  const tasks = (await backendGetNodesByType(ownerUserId, "AsanaTask")) as unknown as AsanaTaskNode[];
  const comments = (await backendGetNodesByType(ownerUserId, "AsanaComment")) as unknown as AsanaCommentNode[];

  for (const task of tasks) {
    if (await isAlreadyChunked(task.canonicalId, task.rawHash)) { skipped++; continue; }

    const taskComments = comments.filter(
      (c) => c.taskCanonicalId === task.canonicalId && !c.isSystem && c.ownerUserId === ownerUserId,
    );
    const parts = [
      task.name,
      task.notes ?? "",
      ...taskComments.map((c) => `Comment: ${c.text}`),
    ].filter(Boolean);
    const text = parts.join("\n");

    const chunks = approxTokens(text) <= TASK_MAX_TOKENS
      ? [text]
      : sentenceWindowChunks(text, TASK_MAX_TOKENS, TASK_OVERLAP_TOKENS);

    await writeSourceAndChunks(task.canonicalId, "AsanaTask", task.name, ownerUserId, task.rawHash, chunks);
    chunked++;
  }

  // AsanaProject — summary chunk (256t)
  const projects = (await backendGetNodesByType(ownerUserId, "AsanaProject")) as unknown as AsanaProjectNode[];
  for (const project of projects) {
    if (await isAlreadyChunked(project.canonicalId, project.rawHash)) { skipped++; continue; }

    const projectTasks = tasks.filter((t) => t.projectCanonicalId === project.canonicalId);
    const text = `Project: ${project.name}\nTasks: ${projectTasks.map((t) => t.name).join(", ")}`;
    const chunks = approxTokens(text) <= PROJECT_MAX_TOKENS
      ? [text]
      : [text.slice(0, PROJECT_MAX_TOKENS * CHARS_PER_TOKEN)];

    await writeSourceAndChunks(project.canonicalId, "AsanaProject", project.name, ownerUserId, project.rawHash, chunks);
    chunked++;
  }

  return { chunked, skipped };
}
