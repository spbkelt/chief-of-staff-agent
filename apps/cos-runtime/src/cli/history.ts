#!/usr/bin/env node
import "dotenv/config";
import { initSchema } from "../graph/graph.db.js";
import { getConversationHistory } from "../history/store.js";

function parseLimitFlag(): number {
  const idx = process.argv.indexOf("--limit");
  if (idx !== -1) {
    const val = parseInt(process.argv[idx + 1] ?? "20", 10);
    return isNaN(val) ? 20 : val;
  }
  return 20;
}

function parseSessionFlag(): string | undefined {
  const idx = process.argv.indexOf("--session");
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function run(): Promise<void> {
  await initSchema();

  const limit = parseLimitFlag();
  const sessionId = parseSessionFlag();

  const turns = await getConversationHistory(sessionId ? { sessionId, limit } : { limit });

  if (turns.length === 0) {
    console.log("No conversation history found.");
    return;
  }

  console.log(`\n=== BigBoss COS — Conversation History (${turns.length} turns) ===\n`);

  let currentSession = "";
  for (const turn of turns) {
    if (turn.sessionId !== currentSession) {
      currentSession = turn.sessionId;
      console.log(`Session: ${turn.sessionId}`);
      console.log("─".repeat(40));
    }
    const when = new Date(turn.createdAt).toLocaleString();
    console.log(`[${turn.role.toUpperCase()}] #${turn.turnIndex}  (${when})`);
    console.log(turn.content);
    console.log();
  }
}

run().catch((err) => {
  console.error("[history] fatal:", err);
  process.exit(1);
});
