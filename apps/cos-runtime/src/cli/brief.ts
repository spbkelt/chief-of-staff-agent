#!/usr/bin/env node
/**
 * Unified calendar timeline (AC-04) — sorted CalendarEvent list for a date range.
 */
import "dotenv/config";
import { getDb } from "../graph/graph.db.js";
import { getEnv } from "../config/env.js";
import { identityId } from "../graph/canonical-id.js";
import type { CalendarEventNode } from "../graph/schema.js";

export type BriefRange = "today" | "tomorrow" | "week";

function rangeBounds(range: BriefRange): { start: string; end: string; label: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (range === "today") {
    const s = startOfDay(now);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString(), label: "Today" };
  }
  if (range === "tomorrow") {
    const t = startOfDay(now);
    t.setDate(t.getDate() + 1);
    const e = new Date(t);
    e.setDate(e.getDate() + 1);
    return { start: t.toISOString(), end: e.toISOString(), label: "Tomorrow" };
  }
  const s = startOfDay(now);
  const e = new Date(s);
  e.setDate(e.getDate() + 7);
  return { start: s.toISOString(), end: e.toISOString(), label: "This week" };
}

export async function fetchTimelineEvents(
  ownerUserId: string,
  range: BriefRange
): Promise<CalendarEventNode[]> {
  const { start, end } = rangeBounds(range);
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT data FROM nodes
          WHERE node_type = 'CalendarEvent'
          AND json_extract(data, '$.ownerUserId') = ?
          AND json_extract(data, '$.startAt') >= ?
          AND json_extract(data, '$.startAt') < ?
          ORDER BY json_extract(data, '$.startAt') ASC`,
    args: [ownerUserId, start, end],
  });

  return result.rows
    .map((r) => {
      const v = r[0];
      return typeof v === "string" ? (JSON.parse(v) as CalendarEventNode) : null;
    })
    .filter((n): n is CalendarEventNode => n !== null);
}

export async function printBrief(ownerUserId: string, range: BriefRange): Promise<void> {
  const { label } = rangeBounds(range);
  const events = await fetchTimelineEvents(ownerUserId, range);

  console.log(`\n── ${label} (${events.length} events) ──\n`);
  if (events.length === 0) {
    console.log("  No calendar events in range. Run ingest after connecting Google.\n");
    return;
  }

  for (const ev of events) {
    const start = ev.startAt?.slice(0, 16).replace("T", " ") ?? "?";
    const title = ev.title ?? "(no title)";
    const loc = ev.location ? ` @ ${ev.location}` : "";
    console.log(`  ${start}  ${title}${loc}`);
    console.log(`           [${ev.canonicalId}]`);
  }
  console.log();
}

function parseRangeArg(): BriefRange {
  const idx = process.argv.indexOf("--date");
  const v = idx !== -1 ? process.argv[idx + 1] : "today";
  if (v === "tomorrow" || v === "week") return v;
  return "today";
}

async function main(): Promise<void> {
  const env = getEnv();
  const ownerEmail = env.COS_OWNER_EMAIL ?? "owner@example.com";
  const ownerId = identityId(ownerEmail);
  await printBrief(ownerId, parseRangeArg());
}

const isMain =
  process.argv[1]?.endsWith("brief.ts") || process.argv[1]?.endsWith("brief.js");
if (isMain) {
  main().catch((err) => {
    console.error("[brief] fatal:", err);
    process.exit(1);
  });
}
