#!/usr/bin/env node
import { initSchema } from "../graph/graph.db.js";
import { backendGetNode, backendUpsertNode } from "../graph/backend.js";
import { identityId } from "../graph/canonical-id.js";
import { getEnv } from "../config/env.js";
import { assertValidTransition } from "../suggestions/lifecycle.js";
import { recordActivity } from "../history/record-activity.js";
import type { SuggestedResponseNode } from "../graph/schema.js";
import type { SuggestionStatus } from "../suggestions/lifecycle.js";

async function run(): Promise<void> {
  // pnpm approve -- <suggestionId> --approve may leave a leading "--" token
  const positional = process.argv.slice(2).filter((a) => a !== "--");
  const suggestionId = positional[0];
  if (!suggestionId) {
    console.error("Usage: pnpm approve -- <suggestionId> [--approve | --reject | --text \"<edited text>\"]");
    process.exit(1);
  }

  const args = positional.slice(1);
  const doApprove = args.includes("--approve");
  const doReject = args.includes("--reject");
  const textIdx = args.indexOf("--text");
  const modifiedText = textIdx !== -1 ? args[textIdx + 1] : undefined;

  if (!doApprove && !doReject && !modifiedText) {
    console.error("Specify one of: --approve, --reject, --text \"<edited text>\"");
    process.exit(1);
  }

  await initSchema();

  const env = getEnv();
  const ownerUserId = identityId(env.COS_OWNER_EMAIL ?? "owner@example.com");

  const node = await backendGetNode(suggestionId);
  if (!node || node.nodeType !== "SuggestedResponse") {
    console.error(`[approve] SuggestedResponse not found: ${suggestionId}`);
    process.exit(1);
  }

  const suggestion = node as SuggestedResponseNode;

  if (suggestion.ownerUserId !== ownerUserId) {
    console.error("[approve] Permission denied: suggestion belongs to a different owner");
    process.exit(1);
  }

  const newStatus: SuggestionStatus = doApprove ? "approved" : doReject ? "rejected" : "modified";
  assertValidTransition(suggestion.status as SuggestionStatus, newStatus);

  const reviewedAt = new Date().toISOString();
  let updated: SuggestedResponseNode;
  if (newStatus === "approved") {
    updated = { ...suggestion, status: "approved", reviewedAt };
  } else if (newStatus === "rejected") {
    updated = { ...suggestion, status: "rejected", reviewedAt };
  } else {
    updated = { ...suggestion, status: "modified", approvedText: modifiedText!, reviewedAt };
  }

  await backendUpsertNode(updated);

  const verb = newStatus === "approved" ? "suggestion.approved" : newStatus === "rejected" ? "suggestion.rejected" : "suggestion.modified";
  await recordActivity(verb, updated.canonicalId, ownerUserId);

  console.log(`\n=== Approval Decision Recorded ===\n`);
  console.log(`ID:          ${updated.canonicalId}`);
  console.log(`Status:      ${updated.status}`);
  console.log(`Reviewed at: ${updated.reviewedAt}`);
  if (updated.approvedText) console.log(`Modified text: ${updated.approvedText}`);
  console.log(`\nNote: No message has been sent. This prototype has no send capability.\n`);
}

run().catch((err) => {
  console.error("[approve] fatal:", err);
  process.exit(1);
});
