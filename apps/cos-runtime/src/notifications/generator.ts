import { getEnv, isMockLLM, allowsFixtures } from "../config/env.js";
import { initLangSmith, flushLangSmith, sanitizeForTrace } from "../observability/langsmith.js";
import { backendRetrieve } from "../rag/backend.js";
import { backendUpsertNode, backendUpsertEdge } from "../graph/backend.js";
import { notificationId } from "../graph/canonical-id.js";
import type { NotificationNode, NotificationTriggerType } from "../graph/schema.js";
import { detectCandidates, isDuplicate, SCORE_THRESHOLD, TOP_N } from "./rules.js";
import type { NotificationCandidate } from "./rules.js";

export interface GenerateOptions {
  now?: Date;
  topN?: number;
  scoreThreshold?: number;
}

export interface GenerateResult {
  generated: NotificationNode[];
  skippedDedup: number;
  skippedThreshold: number;
}

function shouldUseMockLLM(): boolean {
  if (!allowsFixtures() && isMockLLM()) {
    throw new Error(
      "COS_MOCK_LLM is only allowed with COS_ALLOW_FIXTURES=true (CI). Configure LLM in setup."
    );
  }
  return allowsFixtures() && isMockLLM();
}

interface NotificationContent {
  title: string;
  explanation: string;
  suggestedAction: string;
  confidence: number;
}

function mockContent(candidate: NotificationCandidate): NotificationContent {
  const { triggerType, contextHint } = candidate;
  const templates: Record<NotificationTriggerType, NotificationContent> = {
    "upcoming-meeting": {
      title: contextHint.slice(0, 100),
      explanation: `${contextHint}. Review the meeting agenda and any pre-read materials before joining.`,
      suggestedAction: "Open calendar event and review agenda. Join meeting link 2 min early.",
      confidence: 0.95,
    },
    "meeting-prep-needed": {
      title: `Prep needed: ${contextHint.replace("Prep needed — ", "").slice(0, 80)}`,
      explanation: `${contextHint}. No preparation query has been run for this meeting yet.`,
      suggestedAction: "Run `pnpm query` with the meeting topic to retrieve relevant context.",
      confidence: 0.90,
    },
    "unresolved-email-thread": {
      title: `Unresolved thread needs attention`,
      explanation: `${contextHint}. This thread has not been resolved and may need a decision or follow-up.`,
      suggestedAction: "Review the thread and either reply, delegate, or mark as resolved.",
      confidence: 0.85,
    },
    "reply-needed": {
      title: `Reply overdue`,
      explanation: `${contextHint}. A response is expected and the sender may be waiting.`,
      suggestedAction: "Open the thread and draft a reply or delegation note.",
      confidence: 0.90,
    },
    "asana-task-due": {
      title: `Task due soon`,
      explanation: `${contextHint}. This task is assigned to you and due within 24 hours.`,
      suggestedAction: "Complete the task or update its status and communicate a revised timeline.",
      confidence: 0.95,
    },
    "asana-task-overdue": {
      title: `Overdue task requires action`,
      explanation: `${contextHint}. This task was not completed by its due date.`,
      suggestedAction: "Complete the task now, or reassign and communicate updated timeline to stakeholders.",
      confidence: 0.97,
    },
    "asana-mention": {
      title: `You were mentioned in a task`,
      explanation: `${contextHint}. A team member tagged you in a comment requiring attention.`,
      suggestedAction: "Open the task and respond to the mention.",
      confidence: 0.88,
    },
    "missed-commitment": {
      title: `Missed commitment — action required`,
      explanation: `${contextHint}. A task you committed to complete is now overdue.`,
      suggestedAction: "Complete the task or proactively communicate a revised timeline to stakeholders.",
      confidence: 0.95,
    },
    "calendar-task-conflict": {
      title: `Task deadline conflicts with back-to-back meetings`,
      explanation: `${contextHint}. You may not have time to complete this task on the scheduled day.`,
      suggestedAction: "Reschedule the task deadline or block time before the meeting block.",
      confidence: 0.80,
    },
    "repeated-topic-priority": {
      title: `Recurring topic requires your attention`,
      explanation: `${contextHint}. This topic has surfaced multiple times across your communications.`,
      suggestedAction: "Review the recent mentions and consider proactively addressing the underlying issue.",
      confidence: 0.75,
    },
    "executive-priority-signal": {
      title: `High-priority executive item`,
      explanation: `${contextHint}. This item has signals indicating it requires executive attention.`,
      suggestedAction: "Review and determine if immediate action or delegation is needed.",
      confidence: 0.80,
    },
  };
  return templates[triggerType];
}

async function liveLLMContent(
  candidate: NotificationCandidate,
  ownerUserId: string,
  retrievedChunkIds: string[],
  chunkTexts: string[],
): Promise<NotificationContent> {
  const env = getEnv();
  const { generateText } = await import("ai");

  const contextSnippets = chunkTexts.slice(0, 5).join("\n---\n");
  const prompt = `You are a Chief of Staff assistant. Generate a concise notification for the executive.

Trigger: ${candidate.triggerType}
Context summary: ${sanitizeForTrace(candidate.contextHint)}
Retrieved excerpts from knowledge graph:
${contextSnippets}

Respond with a JSON object:
{
  "title": "<one actionable line, max 100 chars>",
  "explanation": "<2-3 sentences citing the context above>",
  "suggestedAction": "<concrete next step>",
  "confidence": <0.0 to 1.0>
}

Rules:
- title must be ≤100 characters
- explanation must reference specific details from the excerpts
- suggestedAction must be concrete, not vague
- confidence reflects how certain you are given the available context`;

  const { getLlmModel } = await import("../llm/provider.js");
  const model = await getLlmModel();

  const { text } = await generateText({ model, prompt });

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`LLM response did not contain JSON: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]) as {
    title: string;
    explanation: string;
    suggestedAction: string;
    confidence: number;
  };

  return {
    title: parsed.title.slice(0, 100),
    explanation: parsed.explanation,
    suggestedAction: parsed.suggestedAction,
    confidence: Math.min(1.0, Math.max(0.0, parsed.confidence ?? 0.7)),
  };
}

export async function generateNotifications(
  ownerUserId: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const now = options.now ?? new Date();
  const topN = options.topN ?? TOP_N;
  const threshold = options.scoreThreshold ?? SCORE_THRESHOLD;
  const useMock = shouldUseMockLLM();

  // Step 1: detect candidates
  const allCandidates = await detectCandidates(ownerUserId, now);

  // Step 2: filter by score threshold
  let skippedThreshold = 0;
  const aboveThreshold = allCandidates.filter((c) => {
    if (c.priorityScore >= threshold) return true;
    skippedThreshold++;
    return false;
  });

  // Step 3: dedup check + take top-N
  let skippedDedup = 0;
  const toGenerate: NotificationCandidate[] = [];
  for (const candidate of aboveThreshold) {
    if (toGenerate.length >= topN) break;
    const dup = await isDuplicate(ownerUserId, candidate.triggerType, candidate.sourceNodeIds, now);
    if (dup) {
      skippedDedup++;
      continue;
    }
    toGenerate.push(candidate);
  }

  if (toGenerate.length === 0) {
    return { generated: [], skippedDedup, skippedThreshold };
  }

  // Step 4: wire LangSmith before any LLM call
  initLangSmith();

  const generated: NotificationNode[] = [];

  for (const candidate of toGenerate) {
    const generatedAt = now.toISOString();
    let content: NotificationContent;
    let retrievedChunkIds: string[] = [];

    if (useMock) {
      content = mockContent(candidate);
    } else {
      // Retrieve context for each sourceNodeId (RAG topK=8)
      const chunkTexts: string[] = [];
      for (const sourceNodeId of candidate.sourceNodeIds) {
        try {
          const result = await backendRetrieve(
            `${candidate.triggerType} context for ${sourceNodeId}`,
            { ownerUserId },
            8,
          );
          retrievedChunkIds.push(...result.retrievedChunkIds);
          chunkTexts.push(...result.chunks.map((c) => c.chunkText));
        } catch {
          // retrieval failure is non-fatal — fall back to mock for this candidate
        }
      }

      if (chunkTexts.length === 0) {
        // No retrieved context — use mock to avoid hallucination
        content = mockContent(candidate);
      } else {
        try {
          content = await liveLLMContent(candidate, ownerUserId, retrievedChunkIds, chunkTexts);
        } catch {
          // LLM failure is non-fatal — fall back to mock
          content = mockContent(candidate);
          retrievedChunkIds = [];
        }
      }
    }

    const canonicalId = notificationId(candidate.triggerType, candidate.sourceNodeIds, generatedAt);

    const node: NotificationNode = {
      nodeType: "Notification",
      canonicalId,
      ownerUserId,
      triggerType: candidate.triggerType,
      priorityScore: candidate.priorityScore,
      title: content.title,
      explanation: content.explanation,
      suggestedAction: content.suggestedAction,
      confidence: content.confidence,
      sourceNodeIds: candidate.sourceNodeIds,
      generatedAt,
      deliveredAt: null,
      status: "pending",
      snoozedUntil: null,
      followUpAt: null,
    };

    await backendUpsertNode(node);

    // Write GENERATED edges from notification → each source node
    for (const sourceNodeId of candidate.sourceNodeIds) {
      await backendUpsertEdge({
        id: `${canonicalId}:generated:${sourceNodeId}`,
        edgeType: "GENERATED",
        fromId: canonicalId,
        toId: sourceNodeId,
        createdAt: generatedAt,
      });
    }

    generated.push(node);
  }

  // Step 5: flush LangSmith
  await flushLangSmith();

  // Return sorted highest priority first
  generated.sort((a, b) => b.priorityScore - a.priorityScore);

  return { generated, skippedDedup, skippedThreshold };
}
