---
name: build-cos-suggestions
description: >
  How the Chief of Staff agent generates intelligent response suggestions:
  the six response types, status gate (never auto-send), tone preservation
  pipeline, fact/assumption separation, and the approval lifecycle. Read
  before touching suggestions/generator.ts or any code that creates or
  transitions SuggestedResponse nodes.
spec-section: "docs/ARCHITECTURE.md"
parent-skills:
  - manage-communication-activity
team-kit-path: ~/.cursor/plugins/local/soofi-xyz/skills/
---

> **Extends team-kit:** `manage-communication-activity` — load from `~/.cursor/plugins/local/soofi-xyz/skills/` first.  
> **COS-only:** This file documents Chief of Staff-specific constraints. Do not duplicate content from the parent skill.  
> **Do not reimplement:** Generic email/thread lifecycle patterns belong in team-kit (`/chatot`), not in this repo.

> **H4.5 implementation gate:** Start with `/chatot` and `manage-communication-activity`. This overlay adds COS graph/RAG input and the approval gate only — do not build a greenfield comms lifecycle engine here.
>
> **Delivered (H4.5):** `suggestions/generator.ts`, `cli/suggest.ts`, `cli/approve.ts` — AC-11 proven.

**Runtime:** Operators use `@bigboss` → `pnpm suggest` / `approve` only. Invoke `/chatot` when **changing** lifecycle rules — not at operator runtime.

# Building COS Response Suggestions

## The Single Most Important Rule

**No code path ever sends a message automatically.**

The `SuggestedResponse` node's `status` field is the only gate. The only valid transitions are:

```
pending
  → approved   (human explicitly calls approve tool)
  → rejected   (human explicitly calls reject tool)
  → modified   (human edits draft) → approved → sent*
```

`sent` is only reachable after `approved` AND an explicit human send action. In the **prototype**, there is no send action at all — `status` can never reach `sent`. The prototype is read-only for all connected services.

Do not add a `send()` function, do not wire an API call to Gmail's send endpoint, do not add a "post comment" call to Asana, even behind a flag. This is not a performance or scope decision — it is a governance principle from the Prism litepaper.

## Response Types (6)

| Type | When generated | Context required |
|---|---|---|
| `email-reply` | `reply-needed` notification OR explicit `@bigboss suggest reply to [subject]` | EmailThread chunks + Identity history + Topic context |
| `asana-comment` | Task mention notification OR explicit request | AsanaTask + project context + related threads |
| `meeting-followup` | Within 4h after meeting ends | CalendarEvent + attendee identities + agenda chunks |
| `delegation` | Task assignment request | AsanaTask + assignee contact history |
| `clarification` | Ambiguous request in email/task | Thread context + executive's previous replies |
| `status-update` | Explicit `@bigboss status update on [project]` | AsanaProject tasks + related EmailThread context |

## Generation Pipeline

```
1. Retrieve context chunks (RAG, topK=12 — more context than notifications)

2. Retrieve tone examples:
   - Query SuggestedResponse nodes with status IN ("approved", "sent")
   - Sort by approvedAt/sentAt DESC, take 5
   - If none exist: note "first run — default professional tone" in toneAssessment

3. Build LLM prompt:
   a. Role framing: "Draft a response on behalf of [executive name]. Match their style."
   b. Tone examples (last 5 approved/sent responses)
   c. Retrieved context with chunk citations
   d. Instruction: "Separate facts from assumptions. Mark assumptions [ASSUMPTION: ...]"
   e. Instruction: "Do NOT commit to any action not supported by context.
                    Use 'I'll review' not 'I'll do X by Y'."

4. Parse LLM output into SuggestedResponse fields:
   - draftText: the suggested response text
   - citedSourceNodeIds: IDs of chunks used (require at least 1)
   - toneAssessment: brief description of tone applied
   - factualBasis: string[] of facts that ground the draft
   - assumptions: string[] of [ASSUMPTION: ...] items extracted from draft

5. Write SuggestedResponse node with status: "pending"

6. Create SUGGESTS edge: Notification → SuggestedResponse (if triggered by notification)

7. Present to executive in Cursor pane — do NOT auto-apply or send
```

Wire LangSmith before step 3. `LangSmith.flush()` after step 7.

## SuggestedResponse Node: Required Fields

Full TypeScript interface: `docs/ARCHITECTURE.md` (SuggestedResponse node)

Fields that must never be empty on creation:
- `draftText` — the actual draft (non-empty)
- `citedSourceNodeIds` — at least one citation (reject generation if empty)
- `toneAssessment` — even if default tone, describe it
- `factualBasis` — at least one item (if none, something is wrong with retrieval)
- `assumptions` — can be empty array `[]` if no assumptions needed
- `status` — always `"pending"` on creation

## Tone Preservation

The last 5 `status === "approved"` or `status === "sent"` SuggestedResponse drafts are used as few-shot tone examples. They are retrieved via:
```sql
SELECT approved_text, draft_text FROM nodes
WHERE json_extract(data,'$.nodeType') = 'SuggestedResponse'
AND json_extract(data,'$.status') IN ('approved', 'sent')
ORDER BY json_extract(data,'$.reviewedAt') DESC
LIMIT 5
```

Use `approvedText` if not null (the human's edited version), otherwise `draftText`. The human's edited version is the better tone signal.

If the executive consistently rejects suggestions, log a pattern note (do not suppress suggestions automatically — that is a policy decision, not an engineering one).

## Fact vs Assumption Separation

This is non-negotiable. Every draft must:
1. State what it knows from retrieved chunks (factualBasis array)
2. Mark anything not directly supported by context as `[ASSUMPTION: ...]` inline in the draft
3. Never make scheduling commitments (`"I'll have this done by Friday"`) unless a specific date/time is found in the retrieved chunks

If the LLM draft contains a commitment without a cited source, regenerate with an explicit instruction to use tentative language.

## History Preservation

Every `SuggestedResponse` is preserved indefinitely regardless of outcome:
- `approved` history → improves future tone examples
- `rejected` history → informs delegation patterns (but do not auto-suppress topics)
- `modified` history → the human's edit is the gold standard for tone

Do not delete `SuggestedResponse` nodes. Their audit trail is a governance requirement.

## Testing

Test file: `src/__tests__/suggestions/`

Required test cases:
1. `no-auto-send.test.ts`: verify no code path can set `status = "sent"` without an explicit human action (simulate the approve handler and confirm it requires an explicit call)
2. `draft-quality.test.ts`: generated draft against fixture thread-001 includes `citedSourceNodeIds`, has at least one `[ASSUMPTION: ...]` item when name is unknown, has non-empty `factualBasis`
3. `history-preservation.test.ts`: rejected suggestion is still in the database after rejection; approved suggestion appears in tone example query
4. Status gate: `status` starts as `"pending"`; cannot transition to `"sent"` without going through `"approved"` first

## What Not to Do

- Do not implement a send function, even as a placeholder with a `TODO`.
- Do not call `GmailConnector.send()` or `AsanaConnector.createComment()` — these methods should not exist in the prototype.
- Do not include full email body text in the LLM prompt. Use retrieved chunks.
- Do not omit `assumptions[]` from the node even if the array is empty — absence vs empty array has different semantics for the audit trail.
- Do not merge `SuggestedResponse` with `Notification` — they are distinct node types. A notification triggers a suggestion; they are linked by the `SUGGESTS` edge.
