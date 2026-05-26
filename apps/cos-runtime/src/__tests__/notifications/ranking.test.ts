import { describe, it, expect } from "vitest";
import {
  computePriorityScore,
  urgencyScore,
  recencyScore,
  WEIGHT_URGENCY,
  WEIGHT_IMPORTANCE,
  WEIGHT_RECENCY,
  WEIGHT_EXEC_SIGNAL,
} from "../../notifications/rules.js";

describe("urgencyScore", () => {
  it("returns 1.0 when deadline has passed", () => {
    expect(urgencyScore(-1)).toBe(1.0);
  });

  it("decays as deadline is further away", () => {
    const soon = urgencyScore(1);
    const later = urgencyScore(48);
    expect(soon).toBeGreaterThan(later);
  });

  it("returns near-zero for far-future deadlines", () => {
    expect(urgencyScore(168)).toBeLessThan(0.1);
  });
});

describe("recencyScore", () => {
  it("returns 1.0 for a zero-day-old event", () => {
    expect(recencyScore(0)).toBeCloseTo(1.0, 5);
  });

  it("decays over time", () => {
    expect(recencyScore(1)).toBeLessThan(recencyScore(0));
    expect(recencyScore(7)).toBeLessThan(recencyScore(1));
  });

  it("clamps negative input to 0 days", () => {
    expect(recencyScore(-5)).toBeCloseTo(1.0, 5);
  });
});

describe("computePriorityScore", () => {
  it("returns value in [0, 1]", () => {
    const score = computePriorityScore({ urgency: 0.5, importance: 0.5, recency: 0.5, execSignal: 0.5 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("max inputs produce 1.0", () => {
    const score = computePriorityScore({ urgency: 1, importance: 1, recency: 1, execSignal: 1 });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("zero inputs produce 0.0", () => {
    const score = computePriorityScore({ urgency: 0, importance: 0, recency: 0, execSignal: 0 });
    expect(score).toBeCloseTo(0.0, 5);
  });

  it("weights sum to 1.0", () => {
    const weightSum = WEIGHT_URGENCY + WEIGHT_IMPORTANCE + WEIGHT_RECENCY + WEIGHT_EXEC_SIGNAL;
    expect(weightSum).toBeCloseTo(1.0, 10);
  });
});

describe("notification ranking — SKILL.md ordering rule", () => {
  // From SKILL.md: overdue Asana task > upcoming meeting > unread email

  it("overdue task scores higher than upcoming meeting", () => {
    // Overdue task: urgency=1.0 (past deadline), importance=0.9 (high priority), recency ~1.0 (just overdue), execSignal=0.8
    const overdueTask = computePriorityScore({
      urgency: 1.0,
      importance: 0.9,
      recency: recencyScore(0.1),
      execSignal: 0.8,
    });

    // Upcoming meeting 45 min away: urgency ~0.85, importance=0.7, recency=1.0, execSignal=0.5
    const upcomingMeeting = computePriorityScore({
      urgency: urgencyScore(0.75),
      importance: 0.7,
      recency: recencyScore(0),
      execSignal: 0.5,
    });

    expect(overdueTask).toBeGreaterThan(upcomingMeeting);
  });

  it("upcoming meeting (imminent) scores higher than unread email thread", () => {
    // Meeting in 30 min
    const upcomingMeeting = computePriorityScore({
      urgency: urgencyScore(0.5),
      importance: 0.7,
      recency: recencyScore(0),
      execSignal: 0.5,
    });

    // Unread email thread 5 days old
    const unreadThread = computePriorityScore({
      urgency: 0.5,
      importance: 0.5,
      recency: recencyScore(5),
      execSignal: 0.3,
    });

    expect(upcomingMeeting).toBeGreaterThan(unreadThread);
  });

  it("asana-task-overdue ranks above asana-task-due (same task attributes)", () => {
    // Overdue: urgency=1.0
    const overdue = computePriorityScore({
      urgency: 1.0,
      importance: 0.7,
      recency: recencyScore(1),
      execSignal: 0.5,
    });

    // Due in 12h: urgency = urgencyScore(12) ≈ 0.61
    const due = computePriorityScore({
      urgency: urgencyScore(12),
      importance: 0.7,
      recency: recencyScore(0),
      execSignal: 0.5,
    });

    expect(overdue).toBeGreaterThan(due);
  });

  it("high-priority task scores higher than medium-priority task (same timing)", () => {
    const highPriority = computePriorityScore({ urgency: 1.0, importance: 0.9, recency: 0.8, execSignal: 0.8 });
    const mediumPriority = computePriorityScore({ urgency: 1.0, importance: 0.7, recency: 0.8, execSignal: 0.5 });
    expect(highPriority).toBeGreaterThan(mediumPriority);
  });
});
