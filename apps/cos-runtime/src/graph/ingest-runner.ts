import { backendUpsertNode } from "./backend.js";
import { writeEdgesForNode } from "./edge-writer.js";
import { loadCursor, saveCursor, resetCursor } from "./sync-cursor.js";
import type { Connector, NormalizedEvent } from "../connectors/connector.interface.js";
import { ConnectorCursorError } from "../connectors/connector.interface.js";
import type { KnowledgeNode } from "./schema.js";

export interface IngestStats {
  written: number;
  skipped: number;
  total: number;
}

async function processEvents(
  gen: AsyncGenerator<NormalizedEvent>,
  counters: { written: number; skipped: number }
): Promise<void> {
  for await (const event of gen) {
    const node = {
      ...event.payload,
      canonicalId: event.eventId,
      rawHash: event.rawHash,
    } as unknown as KnowledgeNode;
    const result = await backendUpsertNode(node);
    if (result.skipped) {
      counters.skipped++;
    } else {
      counters.written++;
    }
    // Always write edges — upsertEdge is ON CONFLICT DO NOTHING (idempotent)
    await writeEdgesForNode(node);
  }
}

export async function runConnectors(connectors: Connector[]): Promise<IngestStats> {
  const counters = { written: 0, skipped: 0 };

  for (const connector of connectors) {
    await connector.verifyAuth();

    const connectorId = connector.config.connectorId;
    const existingCursor = await loadCursor(connectorId);
    const useFullSync = !existingCursor || existingCursor.fullSyncRequired;
    const syncMode = useFullSync ? "full" : "incremental";
    const start = Date.now();
    const beforeWritten = counters.written;
    const beforeSkipped = counters.skipped;

    if (useFullSync) {
      await processEvents(connector.fullSync(), counters);
    } else {
      try {
        await processEvents(connector.incrementalSync(existingCursor), counters);
      } catch (err) {
        if (err instanceof ConnectorCursorError) {
          // Stale cursor (e.g. GCal 410) — reset and fall back to full sync
          await resetCursor(connectorId);
          await processEvents(connector.fullSync(), counters);
        } else {
          throw err;
        }
      }
    }

    const cursor = await connector.currentCursor();
    await saveCursor(cursor);

    const deltaWritten = counters.written - beforeWritten;
    const deltaSkipped = counters.skipped - beforeSkipped;

    // Structured sync audit log per spec §10.6
    console.log(
      JSON.stringify({
        event: "connector.sync",
        connectorId,
        syncMode,
        eventsProcessed: deltaWritten + deltaSkipped,
        eventsWritten: deltaWritten,
        eventsSkipped: deltaSkipped,
        cursorUpdated: true,
        durationMs: Date.now() - start,
      })
    );
    // Human-readable summary for demo/operator visibility
    console.log(`[ingest] ${connectorId}: written=${deltaWritten} skipped=${deltaSkipped}`);
  }

  return { written: counters.written, skipped: counters.skipped, total: counters.written + counters.skipped };
}
