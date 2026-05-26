import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../../");

function parseYamlFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^>$/, "").trim();
    if (key && value) result[key] = value;
  }
  return result;
}

describe("agents/bigboss.md — Cursor agent format", () => {
  const agentPath = path.join(repoRoot, "agents", "bigboss.md");

  it("file exists at agents/bigboss.md", () => {
    expect(fs.existsSync(agentPath)).toBe(true);
  });

  it("has YAML frontmatter with name: bigboss", () => {
    const content = fs.readFileSync(agentPath, "utf-8");
    expect(content.startsWith("---")).toBe(true);
    const fm = parseYamlFrontmatter(content);
    expect(fm["name"]).toBe("bigboss");
  });

  it("has a non-empty description in frontmatter", () => {
    const content = fs.readFileSync(agentPath, "utf-8");
    expect(content).toMatch(/description:/);
    expect(content.length).toBeGreaterThan(200);
  });

  it("contains @bigboss invocation examples", () => {
    const content = fs.readFileSync(agentPath, "utf-8");
    expect(content).toContain("@bigboss");
  });

  it("does NOT contain legacy @slowking references", () => {
    const content = fs.readFileSync(agentPath, "utf-8");
    expect(content).not.toContain("@slowking");
    expect(content).not.toContain("name: slowking");
  });
});

describe(".cursor-plugin/plugin.json — agent reference", () => {
  const pluginPath = path.join(repoRoot, ".cursor-plugin", "plugin.json");

  it("file exists", () => {
    expect(fs.existsSync(pluginPath)).toBe(true);
  });

  it("references agents/ directory", () => {
    const raw = fs.readFileSync(pluginPath, "utf-8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    expect(json["agents"]).toBeTruthy();
  });

  it("description mentions bigboss not slowking", () => {
    const raw = fs.readFileSync(pluginPath, "utf-8");
    const json = JSON.parse(raw) as Record<string, string>;
    expect(json["description"]).toContain("BigBoss");
    expect(json["description"]).not.toContain("Slowking");
  });
});
