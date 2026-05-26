export type SuggestionStatus = "pending" | "approved" | "rejected" | "modified";

export const ALLOWED_TRANSITIONS: Record<SuggestionStatus, SuggestionStatus[]> = {
  pending: ["approved", "rejected", "modified"],
  approved: [],
  rejected: [],
  modified: ["approved", "rejected"],
};

export function assertValidTransition(from: SuggestionStatus, to: SuggestionStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid suggestion transition: ${from} → ${to}`);
  }
}
