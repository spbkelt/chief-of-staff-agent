#!/usr/bin/env node
import "dotenv/config";
import { initSchema } from "../graph/graph.db.js";
import { identityId } from "../graph/canonical-id.js";
import { getEnv } from "../config/env.js";
import { dismissNotification, snoozeNotification } from "../notifications/lifecycle.js";

function usage(): void {
  console.log("Usage:");
  console.log("  pnpm dismiss -- <notification-id>");
  console.log("  pnpm snooze -- <notification-id> [--hours <n>]");
}

async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const isSnooze =
    process.env["npm_lifecycle_event"] === "snooze" || args.includes("--hours");

  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const notificationId = args[0]!;
  await initSchema();

  const env = getEnv();
  if (!env.COS_OWNER_EMAIL) {
    console.error("COS_OWNER_EMAIL is not set. Run `@bigboss validate` to check credentials.");
    process.exit(1);
  }
  const ownerUserId = identityId(env.COS_OWNER_EMAIL);

  if (isSnooze) {
    const hoursIdx = args.indexOf("--hours");
    const hours = hoursIdx !== -1 ? parseFloat(args[hoursIdx + 1] ?? "2") : 2;
    await snoozeNotification(notificationId, ownerUserId, hours);
    console.log(`Snoozed notification ${notificationId} for ${hours} hour(s).`);
  } else {
    await dismissNotification(notificationId, ownerUserId);
    console.log(`Dismissed notification ${notificationId}.`);
  }
}

run().catch((err) => {
  console.error("[dismiss] fatal:", err);
  process.exit(1);
});
