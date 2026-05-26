import { upsertEdge } from "./upsert.js";
import { sha256 } from "./canonical-id.js";
import type { KnowledgeNode, GraphEdge, EdgeType } from "./schema.js";

function makeEdge(fromId: string, edgeType: EdgeType, toId: string): GraphEdge {
  return {
    id: sha256(`${fromId}:${edgeType}:${toId}`),
    edgeType,
    fromId,
    toId,
    createdAt: new Date().toISOString(),
  };
}

export async function writeEdgesForNode(node: KnowledgeNode): Promise<void> {
  const edges: GraphEdge[] = [];

  switch (node.nodeType) {
    case "CalendarEvent":
      // spec §6.3: Identity → CalendarEvent
      edges.push(makeEdge(node.organizerIdentityId, "ORGANIZES", node.canonicalId));
      for (const attendeeId of node.attendeeIdentityIds) {
        edges.push(makeEdge(attendeeId, "ATTENDS", node.canonicalId));
      }
      break;

    case "EmailMessage":
      edges.push(makeEdge(node.canonicalId, "IN_THREAD", node.threadCanonicalId));
      edges.push(makeEdge(node.fromIdentityId, "SENDS", node.canonicalId));
      for (const toId of node.toIdentityIds) {
        edges.push(makeEdge(toId, "RECEIVES", node.canonicalId));
      }
      for (const ccId of node.ccIdentityIds) {
        edges.push(makeEdge(ccId, "RECEIVES", node.canonicalId));
      }
      break;

    // AsanaProject → Workspace relationship is captured in workspaceCanonicalId field;
    // PART_OF is reserved for Identity → Organization per spec §6.3.

    case "AsanaTask":
      if (node.projectCanonicalId) {
        edges.push(makeEdge(node.canonicalId, "IN_PROJECT", node.projectCanonicalId));
      }
      if (node.assigneeIdentityId) {
        edges.push(makeEdge(node.canonicalId, "ASSIGNED_TO", node.assigneeIdentityId));
      }
      break;

    case "AsanaComment":
      edges.push(makeEdge(node.canonicalId, "COMMENTED_ON", node.taskCanonicalId));
      // spec §6.3: AsanaComment → Identity
      edges.push(makeEdge(node.canonicalId, "AUTHORED_BY", node.authorIdentityId));
      break;

    default:
      break;
  }

  for (const edge of edges) {
    await upsertEdge(edge);
  }
}
