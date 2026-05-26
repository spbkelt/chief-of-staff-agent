import { backendGetNode, backendUpsertNode } from "../graph/backend.js";
import { recordActivity } from "../history/record-activity.js";
import type { NotificationNode } from "../graph/schema.js";

export async function dismissNotification(canonicalId: string, ownerUserId: string): Promise<void> {
  const node = await backendGetNode(canonicalId);
  if (!node) throw new Error(`Notification not found: ${canonicalId}`);
  if ((node as NotificationNode).ownerUserId !== ownerUserId) {
    throw new Error("Permission denied: notification belongs to a different owner");
  }

  const updated: NotificationNode = {
    ...(node as NotificationNode),
    status: "dismissed",
  };
  await backendUpsertNode(updated);
  await recordActivity("notification.dismissed", canonicalId, ownerUserId);
}

export async function snoozeNotification(
  canonicalId: string,
  ownerUserId: string,
  hours: number,
): Promise<void> {
  const node = await backendGetNode(canonicalId);
  if (!node) throw new Error(`Notification not found: ${canonicalId}`);
  if ((node as NotificationNode).ownerUserId !== ownerUserId) {
    throw new Error("Permission denied: notification belongs to a different owner");
  }

  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const updated: NotificationNode = {
    ...(node as NotificationNode),
    status: "snoozed",
    snoozedUntil,
  };
  await backendUpsertNode(updated);
  await recordActivity("notification.snoozed", canonicalId, ownerUserId);
}
