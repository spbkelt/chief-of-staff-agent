import { describe, it, expect } from "vitest";
import { assertValidTransition, ALLOWED_TRANSITIONS } from "../../suggestions/lifecycle.js";
import type { SuggestionStatus } from "../../suggestions/lifecycle.js";

describe("suggestion lifecycle transitions", () => {
  it("allows pending → approved", () => {
    expect(() => assertValidTransition("pending", "approved")).not.toThrow();
  });

  it("allows pending → rejected", () => {
    expect(() => assertValidTransition("pending", "rejected")).not.toThrow();
  });

  it("allows pending → modified", () => {
    expect(() => assertValidTransition("pending", "modified")).not.toThrow();
  });

  it("allows modified → approved", () => {
    expect(() => assertValidTransition("modified", "approved")).not.toThrow();
  });

  it("allows modified → rejected", () => {
    expect(() => assertValidTransition("modified", "rejected")).not.toThrow();
  });

  it("rejects approved → rejected (terminal state)", () => {
    expect(() => assertValidTransition("approved", "rejected")).toThrow("Invalid suggestion transition");
  });

  it("rejects approved → modified (terminal state)", () => {
    expect(() => assertValidTransition("approved", "modified")).toThrow("Invalid suggestion transition");
  });

  it("rejects rejected → anything (terminal state)", () => {
    expect(() => assertValidTransition("rejected", "approved")).toThrow("Invalid suggestion transition");
  });

  it("rejects pending → pending (self-transition)", () => {
    expect(() => assertValidTransition("pending", "pending")).toThrow("Invalid suggestion transition");
  });

  it("ALLOWED_TRANSITIONS has no empty arrays for non-terminal states", () => {
    const nonTerminal: SuggestionStatus[] = ["pending", "modified"];
    for (const s of nonTerminal) {
      expect(ALLOWED_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  });

  it("ALLOWED_TRANSITIONS has empty arrays for terminal states", () => {
    expect(ALLOWED_TRANSITIONS["approved"]).toHaveLength(0);
    expect(ALLOWED_TRANSITIONS["rejected"]).toHaveLength(0);
  });
});
