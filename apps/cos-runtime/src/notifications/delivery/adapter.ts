import type { NotificationNode } from "../../graph/schema.js";

export type DeliveryResult = { ok: true; channel: string } | { ok: false; error: string };

export interface NotificationDeliveryAdapter {
  deliver(notification: NotificationNode, ownerUserId: string): Promise<DeliveryResult>;
}
