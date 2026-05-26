import type { NotificationNode } from "../../graph/schema.js";
import type { NotificationDeliveryAdapter, DeliveryResult } from "./adapter.js";

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramDeliveryAdapter implements NotificationDeliveryAdapter {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async deliver(notification: NotificationNode, _ownerUserId: string): Promise<DeliveryResult> {
    const text = [
      `*${escapeMarkdown(notification.title)}*`,
      escapeMarkdown(notification.explanation),
      `→ ${escapeMarkdown(notification.suggestedAction)}`,
    ].join("\n\n");

    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text, parse_mode: "MarkdownV2" }),
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        return { ok: true, channel: "telegram" };
      }

      const body = await resp.text().catch(() => "");
      return { ok: false, error: `Telegram API ${resp.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// Escape special chars per Telegram MarkdownV2 spec
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, (c) => `\\${c}`);
}
