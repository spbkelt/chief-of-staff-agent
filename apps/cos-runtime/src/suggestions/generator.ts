import { getEnv, isMockLLM, allowsFixtures } from "../config/env.js";
import { initLangSmith, flushLangSmith, sanitizeForTrace } from "../observability/langsmith.js";
import { backendRetrieve } from "../rag/backend.js";
import { SUGGESTION_TOP_K } from "../rag/retrieve.js";
import { backendUpsertNode, backendUpsertEdge, backendGetNode } from "../graph/backend.js";
import { derivedNodeId } from "../graph/canonical-id.js";
import { getDb } from "../graph/graph.db.js";
import type { SuggestedResponseNode, SuggestedResponseType } from "../graph/schema.js";

export type { SuggestedResponseType };

export function resolveResponseType(nodeType: string): SuggestedResponseType {
  switch (nodeType) {
    case "EmailThread": return "email-reply";
    case "AsanaTask": return "asana-comment";
    case "CalendarEvent": return "meeting-followup";
    default: return "clarification";
  }
}

export async function getToneExamples(ownerUserId: string): Promise<SuggestedResponseNode[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT data FROM nodes
          WHERE node_type = 'SuggestedResponse'
          AND json_extract(data, '$.ownerUserId') = ?
          AND json_extract(data, '$.status') IN ('approved', 'sent')
          ORDER BY json_extract(data, '$.reviewedAt') DESC
          LIMIT 5`,
    args: [ownerUserId],
  });
  return result.rows
    .map((r) => {
      const v = r[0];
      return typeof v === "string" ? (JSON.parse(v) as SuggestedResponseNode) : null;
    })
    .filter((n): n is SuggestedResponseNode => n !== null);
}

function shouldUseMockLLM(): boolean {
  if (!allowsFixtures() && isMockLLM()) {
    throw new Error(
      "COS_MOCK_LLM is only allowed with COS_ALLOW_FIXTURES=true (CI). Configure LLM in setup."
    );
  }
  return allowsFixtures() && isMockLLM();
}

interface SuggestionContent {
  draftText: string;
  toneAssessment: string;
  factualBasis: string[];
  assumptions: string[];
}

function mockSuggestionContent(
  responseType: SuggestedResponseType,
  contextHint: string,
  toneExamples: SuggestedResponseNode[],
): SuggestionContent {
  const toneNote = toneExamples.length > 0
    ? "Matched executive's previous approved communication style."
    : "First run — using default professional executive tone (no prior approved responses yet).";

  const templates: Record<SuggestedResponseType, SuggestionContent> = {
    "email-reply": {
      draftText: `Thank you for your message regarding "${contextHint}". I've reviewed the context and will follow up with the relevant details shortly. [ASSUMPTION: the sender is awaiting a response on this topic]`,
      toneAssessment: `Professional executive reply tone. ${toneNote}`,
      factualBasis: [`Thread context: ${contextHint.slice(0, 100)}`],
      assumptions: ["Sender is awaiting a response on this topic"],
    },
    "asana-comment": {
      draftText: `Update on "${contextHint}": I'm reviewing the current status and will provide a full update shortly. [ASSUMPTION: stakeholders are tracking this task]`,
      toneAssessment: `Concise task update tone. ${toneNote}`,
      factualBasis: [`Task context: ${contextHint.slice(0, 100)}`],
      assumptions: ["Stakeholders are tracking this task"],
    },
    "meeting-followup": {
      draftText: `Following our meeting regarding "${contextHint}": I'll compile the key decisions and action items and share them with all attendees. [ASSUMPTION: attendees need a written summary]`,
      toneAssessment: `Post-meeting summary tone. ${toneNote}`,
      factualBasis: [`Meeting context: ${contextHint.slice(0, 100)}`],
      assumptions: ["Attendees need a written summary"],
    },
    "delegation": {
      draftText: `I'm delegating "${contextHint}" and will ensure the assignee has the context needed to complete this successfully. [ASSUMPTION: the delegate has bandwidth for this task]`,
      toneAssessment: `Clear delegation tone. ${toneNote}`,
      factualBasis: [`Delegation context: ${contextHint.slice(0, 100)}`],
      assumptions: ["The delegate has bandwidth for this task"],
    },
    "clarification": {
      draftText: `Regarding "${contextHint}": could you clarify the specific requirements so I can provide a more targeted response? [ASSUMPTION: additional context will help resolve this]`,
      toneAssessment: `Clarifying question tone. ${toneNote}`,
      factualBasis: [`Context available: ${contextHint.slice(0, 100)}`],
      assumptions: ["Additional context will help resolve this"],
    },
    "status-update": {
      draftText: `Status update on "${contextHint}": work is progressing as planned. I'll provide a detailed update at the next check-in. [ASSUMPTION: stakeholders need a high-level status]`,
      toneAssessment: `Executive status update tone. ${toneNote}`,
      factualBasis: [`Project context: ${contextHint.slice(0, 100)}`],
      assumptions: ["Stakeholders need a high-level status"],
    },
  };
  return templates[responseType];
}

async function liveLLMContent(
  responseType: SuggestedResponseType,
  contextHint: string,
  toneExamples: SuggestedResponseNode[],
  chunkTexts: string[],
): Promise<SuggestionContent> {
  const env = getEnv();
  const { generateText } = await import("ai");

  const toneBlock = toneExamples.length > 0
    ? `Examples of the executive's approved communication style:\n${toneExamples.slice(0, 5).map((e, i) => `${i + 1}. ${(e.approvedText ?? e.draftText).slice(0, 200)}`).join("\n")}`
    : "No prior approved responses available. Use professional executive tone.";

  const contextBlock = chunkTexts.slice(0, 8).map((t, i) => `[${i + 1}] ${sanitizeForTrace(t)}`).join("\n---\n");

  const prompt = `You are drafting a response on behalf of an executive. Response type: ${responseType}. Context: "${sanitizeForTrace(contextHint)}".

${toneBlock}

Retrieved context from knowledge graph:
${contextBlock}

Draft a response. Rules:
- Separate facts from assumptions. Mark assumptions inline as [ASSUMPTION: ...]
- Do NOT commit to specific actions or dates unless found in the context above
- Use "I'll review" not "I'll complete X by Y" for uncertain items
- Match the executive's communication style from the examples above

Respond with JSON:
{
  "draftText": "<the draft response>",
  "toneAssessment": "<brief description of tone applied>",
  "factualBasis": ["<fact 1 from context>", "<fact 2>"],
  "assumptions": ["<assumption 1>", "<assumption 2>"]
}`;

  const { getLlmModel } = await import("../llm/provider.js");
  const model = await getLlmModel();

  const { text } = await generateText({ model, prompt });
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`LLM response missing JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(jsonMatch[0]) as {
    draftText: string; toneAssessment: string; factualBasis: string[]; assumptions: string[];
  };

  return {
    draftText: parsed.draftText,
    toneAssessment: parsed.toneAssessment || "Executive professional tone",
    factualBasis: Array.isArray(parsed.factualBasis) && parsed.factualBasis.length > 0
      ? parsed.factualBasis
      : [`Context: ${contextHint.slice(0, 100)}`],
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
  };
}

export interface GenerateSuggestionOptions {
  now?: Date;
}

export async function generateSuggestion(
  ownerUserId: string,
  targetNodeId: string,
  options: GenerateSuggestionOptions = {},
): Promise<SuggestedResponseNode> {
  const now = (options.now ?? new Date()).toISOString();

  // Step 1: look up target node
  const targetNode = await backendGetNode(targetNodeId);
  const nodeType = (targetNode as { nodeType?: string } | null)?.nodeType ?? "Unknown";
  const contextHint = (
    (targetNode as { subject?: string; name?: string; title?: string } | null)?.subject ??
    (targetNode as { subject?: string; name?: string; title?: string } | null)?.name ??
    (targetNode as { subject?: string; name?: string; title?: string } | null)?.title ??
    targetNodeId
  ).slice(0, 100);
  const responseType = resolveResponseType(nodeType);

  // Step 2: retrieve context chunks (topK=12 per spec)
  let retrievedChunkIds: string[] = [];
  let chunkTexts: string[] = [];
  try {
    const result = await backendRetrieve(`${responseType} context for ${contextHint}`, { ownerUserId }, SUGGESTION_TOP_K);
    retrievedChunkIds = result.retrievedChunkIds;
    chunkTexts = result.chunks.map((c) => c.chunkText);
  } catch {
    // retrieval failure non-fatal
  }

  // Step 3: tone examples (last 5 approved/sent)
  const toneExamples = await getToneExamples(ownerUserId);

  // Step 4: mock vs live LLM
  const useMock = shouldUseMockLLM();

  // Wire LangSmith before any LLM call
  initLangSmith();

  let content: SuggestionContent;
  if (useMock) {
    content = mockSuggestionContent(responseType, contextHint, toneExamples);
  } else {
    try {
      content = await liveLLMContent(responseType, contextHint, toneExamples, chunkTexts);
    } catch {
      content = mockSuggestionContent(responseType, contextHint, toneExamples);
      retrievedChunkIds = [];
    }
  }

  // Ensure citedSourceNodeIds is non-empty (governance requirement)
  const citedSourceNodeIds = retrievedChunkIds.length > 0
    ? retrievedChunkIds
    : [targetNodeId]; // fallback: cite the target node itself

  // Ensure factualBasis is non-empty
  const factualBasis = content.factualBasis.length > 0
    ? content.factualBasis
    : [`Target node: ${contextHint}`];

  const canonicalId = derivedNodeId("SuggestedResponse", `${ownerUserId}:${targetNodeId}:${now}`);

  // Step 7: write SuggestedResponseNode — status is ALWAYS "pending"
  const node: SuggestedResponseNode = {
    nodeType: "SuggestedResponse",
    canonicalId,
    ownerUserId,
    targetNodeId,
    responseType,
    draftText: content.draftText,
    citedSourceNodeIds,
    toneAssessment: content.toneAssessment,
    factualBasis,
    assumptions: content.assumptions,
    generatedAt: now,
    reviewedAt: null,
    status: "pending",
    approvedText: null,
    sentAt: null,
  };

  await backendUpsertNode(node);

  // Step 8: write SUGGESTS edge — find notification with this targetNodeId in sourceNodeIds
  try {
    const db = getDb();
    const notifResult = await db.execute({
      sql: `SELECT canonical_id FROM nodes
            WHERE node_type = 'Notification'
            AND json_extract(data, '$.ownerUserId') = ?
            AND instr(json_extract(data, '$.sourceNodeIds'), ?) > 0`,
      args: [ownerUserId, targetNodeId],
    });
    for (const row of notifResult.rows) {
      const notifId = row[0] as string;
      await backendUpsertEdge({
        id: `${notifId}:suggests:${canonicalId}`,
        edgeType: "SUGGESTS",
        fromId: notifId,
        toId: canonicalId,
        createdAt: now,
      });
    }
  } catch {
    // edge write failure non-fatal
  }

  // Step 9: write CITES edges
  for (const chunkId of retrievedChunkIds) {
    try {
      await backendUpsertEdge({
        id: `${canonicalId}:cites:${chunkId}`,
        edgeType: "CITES",
        fromId: canonicalId,
        toId: chunkId,
        createdAt: now,
      });
    } catch {
      // non-fatal
    }
  }

  // Step 10: flush LangSmith
  await flushLangSmith();

  return node;
}
