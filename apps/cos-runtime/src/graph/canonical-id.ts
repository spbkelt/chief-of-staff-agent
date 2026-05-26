import { createHash } from "crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function connectorNodeId(connectorId: string, providerEntityId: string): string {
  return sha256(`${connectorId}:${providerEntityId}`);
}

export function derivedNodeId(nodeType: string, normalizedKey: string): string {
  return sha256(`${nodeType}:${normalizedKey}`);
}

export function conversationTurnId(sessionId: string, turnIndex: number): string {
  return sha256(`${sessionId}:${turnIndex.toString()}`);
}

export function notificationId(
  triggerType: string,
  sourceNodeIds: string[],
  generatedAt: string
): string {
  return sha256(`${triggerType}:${sourceNodeIds.join(",")}:${generatedAt}`);
}

// Metadata fields that vary between ingest runs and must not affect the identity hash
const EXCLUDED_FROM_HASH = new Set(["ingestedAt", "updatedAt", "lastSeenAt"]);

export function rawHash(payload: Record<string, unknown>): string {
  const stable = Object.fromEntries(
    Object.entries(payload).filter(([k]) => !EXCLUDED_FROM_HASH.has(k))
  );
  return sha256(JSON.stringify(stable));
}

export function identityId(email: string): string {
  return sha256(email.toLowerCase().trim());
}
