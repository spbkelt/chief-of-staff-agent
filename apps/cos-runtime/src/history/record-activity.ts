import { writeActivityEvent } from "./store.js";

export async function recordActivity(
  verb: string,
  objectNodeId: string,
  ownerUserId: string,
  sourceConnectorId?: string,
): Promise<void> {
  const params: Parameters<typeof writeActivityEvent>[0] = {
    actorId: ownerUserId,
    verb,
    objectNodeId,
    occurredAt: new Date().toISOString(),
  };
  if (sourceConnectorId !== undefined) params.sourceConnectorId = sourceConnectorId;
  await writeActivityEvent(params);
}
