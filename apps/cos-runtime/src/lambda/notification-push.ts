/**
 * EventBridge-triggered Lambda handler: loads pending notifications,
 * delivers them via configured adapters, writes deliveredAt back.
 *
 * Environment variables (set by CDK):
 *   COS_DYNAMO_TABLE, COS_GRAPH_BACKEND=dynamo, AWS_REGION
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (optional, from Secrets Manager)
 */

import { backendUpsertNode, backendGetNodesByType } from "../graph/backend.js";
import { recordActivity } from "../history/record-activity.js";
import type { NotificationDeliveryAdapter } from "../notifications/delivery/adapter.js";
import type { NotificationNode } from "../graph/schema.js";

async function resolveAdapters(): Promise<NotificationDeliveryAdapter[]> {
  const adapters: NotificationDeliveryAdapter[] = [];

  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (botToken && chatId) {
    const { TelegramDeliveryAdapter } = await import("../notifications/delivery/telegram.adapter.js");
    adapters.push(new TelegramDeliveryAdapter(botToken, chatId));
  }

  const { ConsoleDeliveryAdapter } = await import("../notifications/delivery/console.adapter.js");
  adapters.push(new ConsoleDeliveryAdapter());

  return adapters;
}

async function loadPendingNotifications(ownerUserId: string): Promise<NotificationNode[]> {
  const all = await backendGetNodesByType(ownerUserId, "Notification");
  return (all as NotificationNode[])
    .filter((n) => n.status === "pending" && !n.deliveredAt)
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
    .slice(0, 50);
}

export async function handler(_event: unknown): Promise<{ delivered: number; failed: number }> {
  const ownerUserId = process.env["COS_OWNER_USER_ID"] ?? "";
  const adapters = await resolveAdapters();
  const notifications = await loadPendingNotifications(ownerUserId);

  let delivered = 0;
  let failed = 0;

  for (const n of notifications) {
    let anySuccess = false;
    for (const adapter of adapters) {
      const result = await adapter.deliver(n, n.ownerUserId);
      if (result.ok) anySuccess = true;
      else console.warn(`[notification-push] delivery failed: ${result.error}`);
    }

    if (anySuccess) {
      await backendUpsertNode({ ...n, deliveredAt: new Date().toISOString() });
      await recordActivity("notification.delivered", n.canonicalId, n.ownerUserId);
      delivered++;
    } else {
      await recordActivity("notification.delivery_failed", n.canonicalId, n.ownerUserId);
      failed++;
    }
  }

  console.log(`[notification-push] delivered=${delivered} failed=${failed}`);
  return { delivered, failed };
}
