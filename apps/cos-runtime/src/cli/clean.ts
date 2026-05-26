#!/usr/bin/env node
import "dotenv/config";
import { getEnv } from "../config/env.js";
import { getDb, resetDbForTest } from "../graph/graph.db.js";
import os from "os";
import path from "path";
import fs from "fs";

async function run(): Promise<void> {
  const env = getEnv();
  const rawPath = env.COS_DB_PATH;
  const dbPath = rawPath.startsWith("~/")
    ? path.join(os.homedir(), rawPath.slice(2))
    : rawPath;

  // Close any open connection
  resetDbForTest();

  let removed = 0;
  for (const suffix of ["", "-shm", "-wal"]) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[clean] Removed ${removed} database file(s) at ${dbPath}`);
  } else {
    console.log(`[clean] No database files found at ${dbPath} — nothing to clean.`);
  }
}

run().catch((err) => {
  console.error("[clean] fatal:", err);
  process.exit(1);
});
