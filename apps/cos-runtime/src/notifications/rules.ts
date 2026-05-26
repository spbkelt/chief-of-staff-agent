import { getDb } from "../graph/graph.db.js";
import type { NotificationTriggerType } from "../graph/schema.js";

// Priority scoring formula weights — SKILL.md §2. Change here + update spec §8.4 table.
export const WEIGHT_URGENCY = 0.35;
export const WEIGHT_IMPORTANCE = 0.30;
export const WEIGHT_RECENCY = 0.20;
export const WEIGHT_EXEC_SIGNAL = 0.15;

// Trigger windows
export const UPCOMING_MEETING_WINDOW_MS = 60 * 60 * 1000;       // 60 min
export const MEETING_PREP_WINDOW_MS = 3 * 60 * 60 * 1000;       // 3 h
export const UNRESOLVED_THREAD_AGE_MS = 72 * 60 * 60 * 1000;    // 72 h
export const REPLY_NEEDED_AGE_MS = 24 * 60 * 60 * 1000;         // 24 h
export const TASK_DUE_WINDOW_MS = 24 * 60 * 60 * 1000;          // 24 h
export const ASANA_MENTION_WINDOW_MS = 4 * 60 * 60 * 1000;      // 4 h
export const REPEATED_TOPIC_WINDOW_DAYS = 7;
export const REPEATED_TOPIC_MIN_FREQ = 3;

// Pipeline thresholds
export const SCORE_THRESHOLD = 0.40;
export const TOP_N = 10;
export const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 60 min

export interface NotificationCandidate {
  sourceNodeIds: string[];
  triggerType: NotificationTriggerType;
  priorityScore: number;
  contextHint: string; // human-readable label for mock LLM path
}

// urgencyScore: time-pressure decay — higher = more urgent
export function urgencyScore(hoursUntilDeadline: number): number {
  if (hoursUntilDeadline <= 0) return 1.0;
  if (hoursUntilDeadline >= 168) return 0.05;
  return Math.exp(-hoursUntilDeadline / 24);
}

// recencyScore: exponential decay over 7 days
export function recencyScore(daysSinceEvent: number): number {
  return Math.exp(-Math.max(0, daysSinceEvent) / 7);
}

export function computePriorityScore(params: {
  urgency: number;
  importance: number;
  recency: number;
  execSignal: number;
}): number {
  const raw =
    WEIGHT_URGENCY * params.urgency +
    WEIGHT_IMPORTANCE * params.importance +
    WEIGHT_RECENCY * params.recency +
    WEIGHT_EXEC_SIGNAL * params.execSignal;
  return Math.min(1.0, Math.max(0.0, raw));
}

function importanceForPriority(priority: string | null): number {
  if (priority === "high") return 0.9;
  if (priority === "medium") return 0.7;
  return 0.5;
}

function execSignalForPriority(priority: string | null): number {
  if (priority === "high") return 0.8;
  if (priority === "medium") return 0.5;
  return 0.3;
}

// Returns true if an equivalent notification was generated within the last 60 minutes.
export async function isDuplicate(
  ownerUserId: string,
  triggerType: NotificationTriggerType,
  sourceNodeIds: string[],
  now: Date,
): Promise<boolean> {
  const db = getDb();
  const windowStart = new Date(now.getTime() - DEDUP_WINDOW_MS).toISOString();

  const result = await db.execute({
    sql: `SELECT json_extract(data, '$.sourceNodeIds')
          FROM nodes
          WHERE node_type = 'Notification'
            AND json_extract(data, '$.ownerUserId') = ?
            AND json_extract(data, '$.triggerType') = ?
            AND json_extract(data, '$.generatedAt') >= ?
            AND json_extract(data, '$.status') IN ('pending', 'delivered')`,
    args: [ownerUserId, triggerType, windowStart],
  });

  for (const row of result.rows) {
    const stored = JSON.parse(row[0] as string) as string[];
    if (sourceNodeIds.some((id) => stored.includes(id))) return true;
  }

  return false;
}

// Returns true if this (sourceNodeId, triggerType) pair was dismissed within 7 days.
export async function isSuppressedByDismissal(
  ownerUserId: string,
  triggerType: NotificationTriggerType,
  sourceNodeId: string,
  now: Date,
): Promise<boolean> {
  const db = getDb();
  const suppressWindow = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.execute({
    sql: `SELECT COUNT(*)
          FROM nodes
          WHERE node_type = 'Notification'
            AND json_extract(data, '$.ownerUserId') = ?
            AND json_extract(data, '$.triggerType') = ?
            AND json_extract(data, '$.status') = 'dismissed'
            AND json_extract(data, '$.generatedAt') >= ?
            AND json_extract(data, '$.sourceNodeIds') LIKE ?`,
    args: [ownerUserId, triggerType, suppressWindow, `%"${sourceNodeId}"%`],
  });

  const count = result.rows[0]?.[0] as number ?? 0;
  return count > 0;
}

// Detect all notification candidates by querying the graph.
// `now` is injectable for testability.
export async function detectCandidates(
  ownerUserId: string,
  now: Date = new Date(),
): Promise<NotificationCandidate[]> {
  const db = getDb();
  const candidates: NotificationCandidate[] = [];

  const result = await db.execute({
    sql: `SELECT data FROM nodes
          WHERE node_type IN ('CalendarEvent','EmailThread','AsanaTask','AsanaComment','Topic')
            AND json_extract(data, '$.ownerUserId') = ?`,
    args: [ownerUserId],
  });

  for (const row of result.rows) {
    const node = JSON.parse(row[0] as string) as Record<string, unknown>;
    const nodeType = node["nodeType"] as string;

    // ── CalendarEvent triggers ────────────────────────────────────────────────

    if (nodeType === "CalendarEvent") {
      const startAt = new Date(node["startAt"] as string);
      const endAt = new Date(node["endAt"] as string);
      const msUntilStart = startAt.getTime() - now.getTime();

      if (endAt <= now) continue; // already ended — no meeting triggers

      // upcoming-meeting: starts within 60 min
      if (msUntilStart > 0 && msUntilStart <= UPCOMING_MEETING_WINDOW_MS) {
        const hoursUntil = msUntilStart / (1000 * 60 * 60);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "upcoming-meeting",
          priorityScore: computePriorityScore({
            urgency: urgencyScore(hoursUntil),
            importance: 0.7,
            recency: recencyScore(0),
            execSignal: 0.5,
          }),
          contextHint: `Meeting "${node["title"]}" starts in ${Math.round(hoursUntil * 60)} min`,
        });
      }

      // meeting-prep-needed: starts within 1–3h (outside the upcoming-meeting window)
      if (msUntilStart > UPCOMING_MEETING_WINDOW_MS && msUntilStart <= MEETING_PREP_WINDOW_MS) {
        const hoursUntil = msUntilStart / (1000 * 60 * 60);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "meeting-prep-needed",
          priorityScore: computePriorityScore({
            urgency: urgencyScore(hoursUntil),
            importance: 0.6,
            recency: recencyScore(0),
            execSignal: 0.4,
          }),
          contextHint: `Meeting "${node["title"]}" starts in ${Math.round(hoursUntil * 60)} min — prep needed`,
        });
      }
    }

    // ── EmailThread triggers ──────────────────────────────────────────────────

    if (nodeType === "EmailThread") {
      const lastMsgAt = new Date(node["lastMessageAt"] as string);
      const ageMs = now.getTime() - lastMsgAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      // unresolved-email-thread: not resolved AND last message >72h ago
      if (!node["isResolved"] && ageMs > UNRESOLVED_THREAD_AGE_MS) {
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "unresolved-email-thread",
          priorityScore: computePriorityScore({
            urgency: 0.5,
            importance: 0.5,
            recency: recencyScore(ageDays),
            execSignal: 0.3,
          }),
          contextHint: `Thread "${node["subject"]}" unresolved for ${Math.round(ageDays)} days`,
        });
      }

      // reply-needed: replyNeeded=true AND last message >24h ago
      if (node["replyNeeded"] && ageMs > REPLY_NEEDED_AGE_MS) {
        const ageHours = ageMs / (1000 * 60 * 60);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "reply-needed",
          priorityScore: computePriorityScore({
            urgency: Math.min(1.0, ageHours / 96), // ramps up over 4 days
            importance: 0.65,
            recency: recencyScore(ageDays),
            execSignal: 0.4,
          }),
          contextHint: `Thread "${node["subject"]}" needs a reply (${Math.round(ageHours)}h since last message)`,
        });
      }
    }

    // ── AsanaTask triggers ────────────────────────────────────────────────────

    if (nodeType === "AsanaTask") {
      if (node["isCompleted"]) continue;

      const dueAt = node["dueAt"]
        ? new Date(node["dueAt"] as string)
        : node["dueDate"]
          ? new Date(`${node["dueDate"]}T23:59:00Z`)
          : null;

      if (!dueAt) continue;

      const priority = (node["priority"] as string | null) ?? null;
      const msUntilDue = dueAt.getTime() - now.getTime();

      // asana-task-overdue: due date passed
      if (msUntilDue < 0) {
        const daysOverdue = Math.abs(msUntilDue) / (1000 * 60 * 60 * 24);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "asana-task-overdue",
          priorityScore: computePriorityScore({
            urgency: 1.0,
            importance: importanceForPriority(priority),
            recency: recencyScore(daysOverdue),
            execSignal: execSignalForPriority(priority),
          }),
          contextHint: `Task "${node["name"]}" is ${Math.round(daysOverdue)} days overdue`,
        });
      }

      // asana-task-due: due within 24h, not yet overdue
      if (msUntilDue >= 0 && msUntilDue <= TASK_DUE_WINDOW_MS) {
        const hoursUntil = msUntilDue / (1000 * 60 * 60);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "asana-task-due",
          priorityScore: computePriorityScore({
            urgency: urgencyScore(hoursUntil),
            importance: importanceForPriority(priority),
            recency: recencyScore(0),
            execSignal: execSignalForPriority(priority),
          }),
          contextHint: `Task "${node["name"]}" due in ${Math.round(hoursUntil)} hours`,
        });
      }

      // missed-commitment: assigned to owner, overdue (more targeted than generic overdue)
      // assigneeIdentityId is set when the task is assigned to the owner identity
      if (msUntilDue < 0 && node["assigneeIdentityId"]) {
        const daysOverdue = Math.abs(msUntilDue) / (1000 * 60 * 60 * 24);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "missed-commitment",
          priorityScore: computePriorityScore({
            urgency: 1.0,
            importance: importanceForPriority(priority),
            recency: recencyScore(daysOverdue),
            execSignal: Math.min(1.0, execSignalForPriority(priority) + 0.1),
          }),
          contextHint: `Committed task "${node["name"]}" is ${Math.round(daysOverdue)} days overdue`,
        });
      }
    }

    // ── AsanaComment triggers ─────────────────────────────────────────────────

    if (nodeType === "AsanaComment") {
      const createdAt = new Date(node["createdAt"] as string);
      const ageMs = now.getTime() - createdAt.getTime();

      // asana-mention: comment within last 4h containing an @-mention indicator
      if (ageMs <= ASANA_MENTION_WINDOW_MS) {
        const text = (node["text"] as string | null) ?? "";
        if (text.includes("@")) {
          candidates.push({
            sourceNodeIds: [
              node["canonicalId"] as string,
              node["taskCanonicalId"] as string,
            ].filter(Boolean),
            triggerType: "asana-mention",
            priorityScore: computePriorityScore({
              urgency: urgencyScore(ageMs / (1000 * 60 * 60)),
              importance: 0.6,
              recency: recencyScore(ageMs / (1000 * 60 * 60 * 24)),
              execSignal: 0.5,
            }),
            contextHint: `You were mentioned in a task comment`,
          });
        }
      }
    }

    // ── Topic triggers ────────────────────────────────────────────────────────

    if (nodeType === "Topic") {
      const lastSeenAt = new Date(node["lastSeenAt"] as string);
      const ageDays = (now.getTime() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
      const freq = (node["frequency"] as number) ?? 0;

      // repeated-topic-priority: same topic ≥3 times across sources in last 7 days
      if (freq >= REPEATED_TOPIC_MIN_FREQ && ageDays <= REPEATED_TOPIC_WINDOW_DAYS) {
        const normalizedFreq = Math.min(1.0, freq / 10);
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "repeated-topic-priority",
          priorityScore: computePriorityScore({
            urgency: 0.5,
            importance: 0.6,
            recency: recencyScore(ageDays),
            execSignal: normalizedFreq,
          }),
          contextHint: `Topic "${node["label"]}" has appeared ${freq} times in the last ${Math.round(ageDays)} days`,
        });
      }
    }
  }

  // calendar-task-conflict: tasks whose dueDate falls on a back-to-back meeting day
  // Query all meetings + tasks for the owner and cross-reference
  const calResult = await db.execute({
    sql: `SELECT data FROM nodes
          WHERE node_type = 'CalendarEvent'
            AND json_extract(data, '$.ownerUserId') = ?
            AND json_extract(data, '$.endAt') > ?`,
    args: [ownerUserId, now.toISOString()],
  });

  const taskResult = await db.execute({
    sql: `SELECT data FROM nodes
          WHERE node_type = 'AsanaTask'
            AND json_extract(data, '$.ownerUserId') = ?
            AND json_extract(data, '$.isCompleted') = 0`,
    args: [ownerUserId],
  });

  // Find days with 2+ consecutive meetings (back-to-back defined as ≤15 min gap)
  const meetings = calResult.rows
    .map((r) => JSON.parse(r[0] as string) as Record<string, unknown>)
    .filter((e) => e["status"] !== "cancelled")
    .sort((a, b) =>
      new Date(a["startAt"] as string).getTime() - new Date(b["startAt"] as string).getTime()
    );

  const backToBackDays = new Set<string>();
  for (let i = 0; i < meetings.length - 1; i++) {
    const endA = new Date(meetings[i]!["endAt"] as string);
    const startB = new Date(meetings[i + 1]!["startAt"] as string);
    const gapMin = (startB.getTime() - endA.getTime()) / (1000 * 60);
    if (gapMin <= 15) {
      backToBackDays.add(endA.toISOString().slice(0, 10));
    }
  }

  for (const row of taskResult.rows) {
    const task = JSON.parse(row[0] as string) as Record<string, unknown>;
    const dueDate = (task["dueDate"] as string | null) ?? null;
    if (!dueDate) continue;
    const day = dueDate.slice(0, 10);
    if (backToBackDays.has(day)) {
      candidates.push({
        sourceNodeIds: [task["canonicalId"] as string],
        triggerType: "calendar-task-conflict",
        priorityScore: computePriorityScore({
          urgency: urgencyScore(
            (new Date(dueDate + "T23:59:00Z").getTime() - now.getTime()) / (1000 * 60 * 60)
          ),
          importance: importanceForPriority((task["priority"] as string | null) ?? null),
          recency: recencyScore(0),
          execSignal: 0.5,
        }),
        contextHint: `Task "${task["name"]}" due on ${day} when you have back-to-back meetings`,
      });
    }
  }

  // executive-priority-signal: high-priority tasks/threads with exec-signal keywords
  // Heuristic: high priority AND title contains executive-signal terms
  const execKeywords = ["board", "investor", "ceo", "cto", "urgent", "critical", "exec", "deadline"];
  const execResult = await db.execute({
    sql: `SELECT data FROM nodes
          WHERE node_type IN ('AsanaTask','EmailThread')
            AND json_extract(data, '$.ownerUserId') = ?`,
    args: [ownerUserId],
  });

  for (const row of execResult.rows) {
    const node = JSON.parse(row[0] as string) as Record<string, unknown>;
    const text = ((node["name"] ?? node["subject"] ?? "") as string).toLowerCase();
    const isHighPriority = node["priority"] === "high" || (node["labels"] as string[] | undefined)?.includes("IMPORTANT");
    const hasExecKeyword = execKeywords.some((kw) => text.includes(kw));

    if (isHighPriority && hasExecKeyword) {
      const alreadyCovered = candidates.some(
        (c) => c.sourceNodeIds.includes(node["canonicalId"] as string)
      );
      if (!alreadyCovered) {
        candidates.push({
          sourceNodeIds: [node["canonicalId"] as string],
          triggerType: "executive-priority-signal",
          priorityScore: computePriorityScore({
            urgency: 0.6,
            importance: 0.9,
            recency: recencyScore(0),
            execSignal: 0.9,
          }),
          contextHint: `High-priority executive item: "${(node["name"] ?? node["subject"]) as string}"`,
        });
      }
    }
  }

  // Sort by priority descending, deduplicate by (triggerType, primary sourceNodeId)
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = `${c.triggerType}:${c.sourceNodeIds[0]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
