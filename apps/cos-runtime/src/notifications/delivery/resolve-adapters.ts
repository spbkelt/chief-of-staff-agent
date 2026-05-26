import { backendUpsertNode } from "../../graph/backend.js";
import { recordActivity } from "../../history/record-activity.js";
import type { NotificationNode } from "../../graph/schema.js";
import type { CosConfig } from "../../config/credentials.js";
import type { NotificationDeliveryAdapter } from "./adapter.js";

export async function resolveNotificationAdapters(
  config: CosConfig,
): Promise<NotificationDeliveryAdapter[]> {
  const channels = config.notifications?.channels ?? ["console"];
  const adapters: NotificationDeliveryAdapter[] = [];

  if (channels.includes("telegram") && config.telegram?.botToken && config.telegram?.chatId) {
    const { TelegramDeliveryAdapter } = await import("./telegram.adapter.js");
    adapters.push(new TelegramDeliveryAdapter(config.telegram.botToken, config.telegram.chatId));
  }

  const { ConsoleDeliveryAdapter } = await import("./console.adapter.js");
  adapters.push(new ConsoleDeliveryAdapter());

  return adapters;
}

/** @returns true if at least one adapter delivered successfully */
export async function deliverNotificationToChannels(
  notification: NotificationNode,
  ownerUserId: string,
  adapters: NotificationDeliveryAdapter[],
): Promise<boolean> {
  let anySuccess = false;
  for (const adapter of adapters) {
    const result = await adapter.deliver(notification, ownerUserId);
    if (result.ok) {
      anySuccess = true;
    } else {
      console.warn(`   ⚠️  Delivery failed (${result.error})`);
    }
  }

  if (anySuccess) {
    await backendUpsertNode({ ...notification, deliveredAt: new Date().toISOString() });
    await recordActivity("notification.delivered", notification.canonicalId, ownerUserId);
  } else {
    await recordActivity("notification.delivery_failed", notification.canonicalId, ownerUserId);
  }

  return anySuccess;
}
