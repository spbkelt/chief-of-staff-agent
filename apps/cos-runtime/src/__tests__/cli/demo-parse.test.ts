import { describe, it, expect } from "vitest";
import { DEFAULT_DEMO_QUERY, parseDemoArgv } from "../../cli/demo-parse.js";

describe("parseDemoArgv", () => {
  it("defaults query when no args", () => {
    expect(parseDemoArgv([])).toEqual({ skipIngest: false, queryText: DEFAULT_DEMO_QUERY });
  });

  it("parses --skip-ingest and --query", () => {
    expect(parseDemoArgv(["--skip-ingest", "--query", "urgent", "tasks"])).toEqual({
      skipIngest: true,
      queryText: "urgent tasks",
    });
  });
});
