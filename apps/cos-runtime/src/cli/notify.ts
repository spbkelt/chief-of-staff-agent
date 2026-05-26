#!/usr/bin/env node
import "dotenv/config";
import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { initSchema } from "../graph/graph.db.js";
import { identityId } from "../graph/canonical-id.js";
import { getEnv } from "../config/env.js";
import { generateNotifications } from "../notifications/generator.js";
import { readCosConfig } from "../config/credentials.js";
import { recordActivity } from "../history/record-activity.js";
import {
  resolveNotificationAdapters,
  deliverNotificationToChannels,
} from "../notifications/delivery/resolve-adapters.js";

async function run(): Promise<void> {
  applyCosRuntimeEnv();
  await initSchema();

  const env = getEnv();
  if (!env.COS_OWNER_EMAIL) {
    console.error("[notify] COS_OWNER_EMAIL is not set. Run `pnpm validate` to check credentials.");
    process.exit(1);
  }

  const ownerUserId = identityId(env.COS_OWNER_EMAIL);
  const cosConfig = readCosConfig();
  const adapters = await resolveNotificationAdapters(cosConfig);

  console.log("\n=== BigBoss COS — Contextual Notifications ===\n");

  const result = await generateNotifications(ownerUserId);

  if (result.generated.length === 0) {
    console.log("No notifications generated.");
    if (result.skippedDedup > 0) console.log(`  (${result.skippedDedup} skipped — within 60-min dedup window)`);
    if (result.skippedThreshold > 0) console.log(`  (${result.skippedThreshold} below score threshold)`);
    return;
  }

  console.log(`Generated ${result.generated.length} notification(s):\n`);

  for (let i = 0; i < result.generated.length; i++) {
    const n = result.generated[i]!;
    const score = n.priorityScore.toFixed(2);
    const confidence = (n.confidence * 100).toFixed(0);

    console.log(`${i + 1}. [${n.triggerType}] score=${score} confidence=${confidence}%`);
    console.log(`   Title: ${n.title}`);
    console.log(`   ${n.explanation}`);
    console.log(`   → Action: ${n.suggestedAction}`);
    console.log(`   Sources: ${n.sourceNodeIds.join(", ")}`);

    await recordActivity("notification.generated", n.canonicalId, ownerUserId);
    await deliverNotificationToChannels(n, ownerUserId, adapters);
    console.log();
  }

  if (result.skippedDedup > 0) console.log(`${result.skippedDedup} notification(s) skipped (within 60-min dedup window)`);
  if (result.skippedThreshold > 0) console.log(`${result.skippedThreshold} candidate(s) below score threshold`);
}

run().catch((err) => {
  console.error("[notify] fatal:", err);
  process.exit(1);
});
