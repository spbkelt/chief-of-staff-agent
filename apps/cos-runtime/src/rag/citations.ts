/**
 * Deep-link and citation helpers for RAG CLI output (shared by retrieve, paths).
 */

export function buildCitation(
  sourceType: string,
  sourceNodeId: string,
  node: Record<string, unknown> | null,
): string {
  if (!node) return `[source: ${sourceType}:${sourceNodeId}]`;

  if (sourceType === "EmailThread" || sourceType === "EmailMessage") {
    const tid = (node["providerThreadId"] ?? node["threadCanonicalId"]) as string | undefined;
    if (tid) return `https://mail.google.com/mail/u/0/#inbox/${tid}`;
  }
  if (sourceType === "CalendarEvent") {
    const url = node["meetingUrl"] as string | undefined;
    if (url) return url;
  }
  if (sourceType === "AsanaTask" || sourceType === "AsanaComment") {
    const gid =
      (node["providerTaskGid"] as string | undefined) ??
      (node["taskCanonicalId"] as string | undefined);
    if (gid && sourceType === "AsanaTask") {
      return `https://app.asana.com/0/0/${gid}`;
    }
    if (sourceType === "AsanaComment" && node["taskCanonicalId"]) {
      return `[source: AsanaComment:${sourceNodeId}]`;
    }
  }
  if (sourceType === "AsanaProject") {
    const gid = node["providerProjectGid"] as string | undefined;
    if (gid) return `https://app.asana.com/0/0/${gid}`;
  }
  return `[source: ${sourceType}:${sourceNodeId}]`;
}

export function extractReferenceDate(node: Record<string, unknown>): string | null {
  if (typeof node["startAt"] === "string") return node["startAt"];
  if (typeof node["sentAt"] === "string") return node["sentAt"];
  if (typeof node["dueDate"] === "string" && node["dueDate"]) return node["dueDate"];
  if (typeof node["createdAt"] === "string") return node["createdAt"];
  return null;
}

/** True when citation is an https URL (not a bracket fallback). */
export function isDeepLinkUrl(citation: string): boolean {
  return citation.startsWith("https://");
}
