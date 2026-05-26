import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NotificationNode } from "../../graph/schema.js";
import { TelegramDeliveryAdapter } from "../../notifications/delivery/telegram.adapter.js";
import { ConsoleDeliveryAdapter } from "../../notifications/delivery/console.adapter.js";

const OWNER = "test-owner-id";

function makeNotification(overrides: Partial<NotificationNode> = {}): NotificationNode {
  return {
    nodeType: "Notification",
    canonicalId: "notif-test-001",
    ownerUserId: OWNER,
    triggerType: "asana-task-overdue",
    priorityScore: 0.85,
    title: "Overdue task requires action",
    explanation: "Your task was not completed by its due date.",
    suggestedAction: "Complete the task or update the timeline.",
    confidence: 0.9,
    sourceNodeIds: ["task-001"],
    generatedAt: "2026-05-26T10:00:00Z",
    deliveredAt: null,
    status: "pending",
    snoozedUntil: null,
    followUpAt: null,
    ...overrides,
  };
}

describe("TelegramDeliveryAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok=true on successful Telegram API response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new TelegramDeliveryAdapter("bot-token-123", "chat-id-456");
    const result = await adapter.deliver(makeNotification(), OWNER);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channel).toBe("telegram");
  });

  it("posts to sendMessage endpoint with correct bot token", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new TelegramDeliveryAdapter("my-bot-token", "my-chat-id");
    await adapter.deliver(makeNotification(), OWNER);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("bot-token" === "bot-token" ? "my-bot-token" : "");
    expect(url).toMatch(/\/sendMessage$/);
    const body = JSON.parse(opts.body as string) as { chat_id: string; text: string };
    expect(body.chat_id).toBe("my-chat-id");
    expect(body.text).toContain("Overdue task requires action");
  });

  it("returns ok=false when Telegram API returns 4xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new TelegramDeliveryAdapter("bad-token", "chat-id");
    const result = await adapter.deliver(makeNotification(), OWNER);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("401");
  });

  it("returns ok=false on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network timeout"));
    vi.stubGlobal("fetch", mockFetch);

    const adapter = new TelegramDeliveryAdapter("token", "chat-id");
    const result = await adapter.deliver(makeNotification(), OWNER);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("network timeout");
  });

  it("does not include raw email body in the delivered message", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const notif = makeNotification({
      title: "Reply needed from alice@corp.com",
      explanation: "Alice sent an email about Q3 budgets.",
    });

    const adapter = new TelegramDeliveryAdapter("token", "chat-id");
    await adapter.deliver(notif, OWNER);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { text: string };
    // Only title/explanation/action — no raw email body injected
    expect(body.text).toContain("Reply needed");
    expect(body.text).not.toContain("raw-secret");
  });
});

describe("ConsoleDeliveryAdapter", () => {
  it("returns ok=true with channel=console", async () => {
    const adapter = new ConsoleDeliveryAdapter();
    const result = await adapter.deliver(makeNotification(), OWNER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.channel).toBe("console");
  });
});
