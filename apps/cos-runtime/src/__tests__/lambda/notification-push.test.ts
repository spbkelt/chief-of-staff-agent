import { describe, it, expect, vi, beforeEach } from "vitest";

const pendingNotifications = [
  {
    nodeType: "Notification",
    canonicalId: "notif-001",
    ownerUserId: "owner-1",
    title: "Test",
    body: "Body",
    status: "pending",
    priorityScore: 0.9,
    triggerType: "deadline-approaching",
    sourceNodeIds: [],
    createdAt: new Date().toISOString(),
  },
];

const upserted: unknown[] = [];
const activities: string[] = [];

vi.mock("../../graph/backend.js", () => ({
  backendGetNodesByType: vi.fn(async (_ownerUserId: string, nodeType: string) => {
    if (nodeType === "Notification") return pendingNotifications;
    return [];
  }),
  backendUpsertNode: vi.fn(async (node: unknown) => {
    upserted.push(node);
    return { canonicalId: (node as { canonicalId: string }).canonicalId, skipped: false };
  }),
}));

vi.mock("../../history/record-activity.js", () => ({
  recordActivity: vi.fn(async (verb: string) => { activities.push(verb); }),
}));

vi.mock("../../notifications/delivery/console.adapter.js", () => ({
  ConsoleDeliveryAdapter: vi.fn(() => ({
    deliver: vi.fn(async () => ({ ok: true })),
  })),
}));

vi.mock("../../notifications/delivery/telegram.adapter.js", () => ({
  TelegramDeliveryAdapter: vi.fn(() => ({
    deliver: vi.fn(async () => ({ ok: true })),
  })),
}));

beforeEach(() => {
  upserted.length = 0;
  activities.length = 0;
  process.env["COS_OWNER_USER_ID"] = "owner-1";
  vi.resetModules();
});

describe("lambda/notification-push handler", () => {
  it("delivers pending notifications and writes deliveredAt", async () => {
    const { handler } = await import("../../lambda/notification-push.js");
    const result = await handler({});

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(upserted).toHaveLength(1);
    expect((upserted[0] as { deliveredAt?: string }).deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("records notification.delivered activity on success", async () => {
    const { handler } = await import("../../lambda/notification-push.js");
    await handler({});
    expect(activities).toContain("notification.delivered");
  });

  it("records delivery_failed when adapter fails", async () => {
    vi.doMock("../../notifications/delivery/console.adapter.js", () => ({
      ConsoleDeliveryAdapter: vi.fn(() => ({
        deliver: vi.fn(async () => ({ ok: false, error: "network error" })),
      })),
    }));
    vi.resetModules();
    const { handler } = await import("../../lambda/notification-push.js");
    const result = await handler({});
    expect(result.failed).toBe(1);
    expect(result.delivered).toBe(0);
  });
});
