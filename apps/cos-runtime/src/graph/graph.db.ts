import { createClient, type Client } from "@libsql/client";
import { getEnv } from "../config/env.js";
import os from "os";
import path from "path";
import fs from "fs";

let _client: Client | undefined;

function resolveDbPath(rawPath: string): string {
  if (rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

export function getDb(): Client {
  if (_client) return _client;
  const env = getEnv();
  const dbPath = resolveDbPath(env.COS_DB_PATH);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  _client = createClient({ url: `file:${dbPath}` });
  return _client;
}

export async function initSchema(): Promise<void> {
  const db = getDb();

  // libSQL enables FK checking by default; disable for prototype where constraints
  // are managed by application logic (ON CONFLICT DO NOTHING / idempotent upserts)
  await db.execute("PRAGMA foreign_keys = OFF");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS nodes (
      canonical_id TEXT PRIMARY KEY,
      node_type    TEXT NOT NULL,
      data         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      raw_hash     TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type)
  `);

  // No FK constraints on from_id/to_id: edges may reference nodes not yet ingested
  // (e.g. Identity nodes created by a later connector batch)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS edges (
      id          TEXT PRIMARY KEY,
      edge_type   TEXT NOT NULL,
      from_id     TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      created_at  TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_sources (
      canonical_id   TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      source_type    TEXT NOT NULL,
      title          TEXT,
      owner_user_id  TEXT NOT NULL,
      raw_hash       TEXT,
      created_at     TEXT
    )
  `);

  // Migration: add raw_hash to rag_sources if column is missing (existing DBs)
  try {
    await db.execute("ALTER TABLE rag_sources ADD COLUMN raw_hash TEXT");
  } catch {
    // Column already exists — ignore
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      canonical_id      TEXT PRIMARY KEY,
      source_id         TEXT NOT NULL,
      chunk_index       INTEGER NOT NULL,
      chunk_text        TEXT NOT NULL,
      embedding         TEXT,
      embedding_model   TEXT,
      embedding_dims    INTEGER,
      token_count       INTEGER,
      owner_user_id     TEXT NOT NULL,
      created_at        TEXT,
      FOREIGN KEY (source_id) REFERENCES rag_sources(canonical_id)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source_id)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_links (
      id             TEXT PRIMARY KEY,
      from_chunk_id  TEXT NOT NULL,
      to_chunk_id    TEXT NOT NULL,
      link_type      TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_cursors (
      connector_id        TEXT PRIMARY KEY,
      last_synced_at      TEXT,
      provider_cursor     TEXT,
      full_sync_required  INTEGER DEFAULT 0
    )
  `);
}

export async function closeDb(): Promise<void> {
  if (_client) {
    _client.close();
    _client = undefined;
  }
}

export function resetDbForTest(): void {
  _client = undefined;
}
