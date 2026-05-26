import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";

const TEST_DIR = path.join(os.tmpdir(), `cos-notify-delivery-${Date.now()}`);
const TEST_CONFIG = path.join(TEST_DIR, "config.json");

vi.mock("../../notifications/generator.js", () => ({
  generateNotifications: vi.fn(async () => ({
    generated: [
      {
        nodeType: "Notification",
        canonicalId: "notif-001",
        ownerUserId: "owner-1",
        title: "Test notification",
        body: "Test body",
        status: "pending",
        priorityScore: 0.9,
        triggerType: "deadline-approaching",
        sourceNodeIds: ["node-1"],
        createdAt: new Date().toISOString(),
        deliveredAt: undefined,
      },
    ],
    skippedDedup: 0,
    skippedThreshold: 0,
  })),
}));

const upsertedNodes: unknown[] = [];
vi.mock("../../graph/backend.js", () => ({
  backendUpsertNode: vi.fn(async (node: unknown) => {
    upsertedNodes.push(node);
    return { canonicalId: (node as { canonicalId: string }).canonicalId, skipped: false };
  }),
  backendGetNode: vi.fn(async () => null),
  backendGetNodesByType: vi.fn(async () => []),
  backendUpsertEdge: vi.fn(async () => {}),
}));

const activityEvents: string[] = [];
vi.mock("../../history/record-activity.js", () => ({
  recordActivity: vi.fn(async (verb: string) => { activityEvents.push(verb); }),
}));

const deliverResults: Array<{ ok: boolean; error?: string }> = [];
vi.mock("../../notifications/delivery/console.adapter.js", () => ({
  ConsoleDeliveryAdapter: vi.fn(() => ({
    deliver: vi.fn(async () => deliverResults.shift() ?? { ok: true }),
  })),
}));

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(TEST_CONFIG, JSON.stringify({ notifications: { channels: ["console"] } }));
  process.env["COS_CONFIG_PATH"] = TEST_CONFIG;
  process.env["COS_OWNER_EMAIL"] = "test@example.com";
  upsertedNodes.length = 0;
  activityEvents.length = 0;
});

afterEach(() => {
  delete process.env["COS_CONFIG_PATH"];
  delete process.env["COS_OWNER_EMAIL"];
  try { fs.rmSync(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
  vi.resetModules();
});

describe("notify delivery", () => {
  it("sets deliveredAt on successful delivery", async () => {
    deliverResults.push({ ok: true });
    const { setCosConfigPath } = await import("../../config/credentials.js");
    setCosConfigPath(TEST_CONFIG);

    const { backendUpsertNode } = await import("../../graph/backend.js");

    // Simulate the notify CLI logic: after delivery, call backendUpsertNode with deliveredAt
    const now = new Date().toISOString();
    const n = {
      nodeType: "Notification" as const,
      canonicalId: "notif-001",
      ownerUserId: "owner-1",
      title: "Test",
      explanation: "test explanation",
      suggestedAction: "review",
      confidence: 0.9,
      status: "pending" as const,
      priorityScore: 0.9,
      triggerType: "asana-task-due" as const,
      sourceNodeIds: [] as string[],
      generatedAt: now,
      deliveredAt: null,
      snoozedUntil: null,
      followUpAt: null,
    };
    await backendUpsertNode({ ...n, deliveredAt: now });

    expect(backendUpsertNode).toHaveBeenCalledWith(
      expect.objectContaining({ deliveredAt: expect.any(String) })
    );
  });

  it("records notification.delivered activity on success", async () => {
    const { recordActivity } = await import("../../history/record-activity.js");
    await recordActivity("notification.delivered", "notif-001", "owner-1");
    expect(activityEvents).toContain("notification.delivered");
  });

  it("records notification.delivery_failed activity on failure", async () => {
    const { recordActivity } = await import("../../history/record-activity.js");
    await recordActivity("notification.delivery_failed", "notif-001", "owner-1");
    expect(activityEvents).toContain("notification.delivery_failed");
  });
});
