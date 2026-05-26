import { getDb } from "./graph.db.js";
import type { SyncCursor } from "../connectors/connector.interface.js";

export async function loadCursor(connectorId: string): Promise<SyncCursor | null> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT connector_id, last_synced_at, provider_cursor, full_sync_required FROM sync_cursors WHERE connector_id = ?",
    args: [connectorId],
  });

  if (result.rows.length === 0) return null;

  const r = result.rows[0]!;
  return {
    connectorId: r[0] as string,
    lastSyncedAt: r[1] as string,
    providerCursor: r[2] as string,
    fullSyncRequired: Boolean(r[3]),
  };
}

export async function saveCursor(cursor: SyncCursor): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO sync_cursors (connector_id, last_synced_at, provider_cursor, full_sync_required)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (connector_id) DO UPDATE SET
            last_synced_at     = excluded.last_synced_at,
            provider_cursor    = excluded.provider_cursor,
            full_sync_required = excluded.full_sync_required`,
    args: [
      cursor.connectorId,
      cursor.lastSyncedAt,
      cursor.providerCursor,
      cursor.fullSyncRequired ? 1 : 0,
    ],
  });
}

export async function resetCursor(connectorId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM sync_cursors WHERE connector_id = ?",
    args: [connectorId],
  });
}
