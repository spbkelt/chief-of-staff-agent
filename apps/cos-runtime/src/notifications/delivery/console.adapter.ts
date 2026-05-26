import type { NotificationNode } from "../../graph/schema.js";
import type { NotificationDeliveryAdapter, DeliveryResult } from "./adapter.js";

export class ConsoleDeliveryAdapter implements NotificationDeliveryAdapter {
  async deliver(notification: NotificationNode, _ownerUserId: string): Promise<DeliveryResult> {
    console.log(`[notify] ${notification.title}`);
    console.log(`  ${notification.explanation}`);
    console.log(`  → ${notification.suggestedAction}`);
    return { ok: true, channel: "console" };
  }
}
