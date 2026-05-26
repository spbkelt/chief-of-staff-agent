import { describe, expect, it } from "vitest";
import {
  DEFAULT_INGEST_WINDOW,
  formatIngestWindow,
  parseDurationToDays,
  parseIngestArgv,
} from "../../config/ingest-window.js";

describe("parseDurationToDays", () => {
  it("parses days", () => {
    expect(parseDurationToDays("7d")).toBe(7);
    expect(parseDurationToDays("14 days")).toBe(14);
  });

  it("parses weeks", () => {
    expect(parseDurationToDays("2w")).toBe(14);
    expect(parseDurationToDays("1 week")).toBe(7);
  });

  it("parses months as 30-day units", () => {
    expect(parseDurationToDays("1m")).toBe(30);
    expect(parseDurationToDays("2 months")).toBe(60);
  });

  it("rejects invalid tokens", () => {
    expect(() => parseDurationToDays("7")).toThrow(/Invalid duration/);
  });
});

describe("parseIngestArgv", () => {
  it("defaults to 30d past and future", () => {
    const { window } = parseIngestArgv([]);
    expect(window).toEqual(DEFAULT_INGEST_WINDOW);
  });

  it("--period sets symmetric window", () => {
    const { window } = parseIngestArgv(["--period", "7d"]);
    expect(window.pastDays).toBe(7);
    expect(window.futureDays).toBe(7);
  });

  it("--past and --future override independently", () => {
    const { window } = parseIngestArgv(["--past", "2w", "--future", "1w"]);
    expect(window.pastDays).toBe(14);
    expect(window.futureDays).toBe(7);
  });

  it("parses --connector", () => {
    const { connectorFilter } = parseIngestArgv(["--connector", "gmail"]);
    expect(connectorFilter).toBe("gmail");
  });
});

describe("formatIngestWindow", () => {
  it("describes the window for logs", () => {
    expect(formatIngestWindow({ pastDays: 7, futureDays: 14 })).toContain("past 7d");
    expect(formatIngestWindow({ pastDays: 7, futureDays: 14 })).toContain("future 14d");
  });
});
