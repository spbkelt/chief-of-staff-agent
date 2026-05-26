#!/usr/bin/env node
import readline from "readline";
import {
  getCosConfigPath,
  hasCosConfigFile,
  summarizeCosConfig,
} from "../config/credentials.js";
import {
  hr,
  prompt,
  runFullWizard,
  stepAsana,
  stepAwsAutomation,
  stepAwsProductionBundle,
  stepGoogle,
  stepGraphStorage,
  stepIdentity,
  stepLlmProvider,
  stepMicrosoft,
  stepRagBackend,
  stepTelegram,
  stepVerify,
} from "./setup-steps.js";

const MENU: Array<{ key: string; label: string; run: (rl: readline.Interface) => Promise<void> }> = [
  { key: "1", label: "Owner identity", run: stepIdentity },
  { key: "2", label: "Google Workspace (Calendar + Gmail)", run: stepGoogle },
  { key: "3", label: "Microsoft 365 [optional]", run: stepMicrosoft },
  { key: "4", label: "Asana PAT", run: stepAsana },
  { key: "5", label: "AI provider (Bedrock / OpenAI / Anthropic)", run: stepLlmProvider },
  { key: "6", label: "Knowledge graph storage (libSQL / DynamoDB)", run: stepGraphStorage },
  { key: "7", label: "RAG search backend (local / OpenSearch)", run: stepRagBackend },
  { key: "8", label: "AWS automation (Lambda + EventBridge ARNs)", run: stepAwsAutomation },
  {
    key: "9",
    label: "AWS production bundle (Bedrock + DynamoDB + OpenSearch + automation)",
    run: stepAwsProductionBundle,
  },
  { key: "10", label: "Telegram notifications", run: stepTelegram },
  { key: "11", label: "Verify config & optional first sync", run: stepVerify },
  { key: "all", label: "Full setup wizard (all sections)", run: runFullWizard },
];

function printBanner(): void {
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║          BigBoss COS — Setup Wizard        ║");
  console.log("╚═══════════════════════════════════════════╝\n");
}

function printExistingSummary(): void {
  const path = getCosConfigPath();
  console.log(`Existing configuration: ${path}\n`);
  for (const s of summarizeCosConfig()) {
    const mark = s.configured ? "✅" : "○";
    console.log(`  ${mark} ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
  }
  console.log();
}

function printMenu(): void {
  console.log("Choose what to configure (comma-separated keys, e.g. 4,5,9,10):");
  hr();
  for (const item of MENU) {
    if (item.key === "all") {
      console.log(`  ${item.key.padEnd(4)} Full wizard — all sections`);
    } else {
      console.log(`  ${item.key.padEnd(4)} ${item.label}`);
    }
  }
  console.log(`  q    Save and exit`);
  hr();
  console.log("Press Enter on a prompt to keep existing values where shown.\n");
}

function parseMenuSelection(raw: string): string[] {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "q") return [];
  if (trimmed === "all") return ["all"];
  return trimmed
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runSelectiveSetup(rl: readline.Interface): Promise<void> {
  printExistingSummary();
  printMenu();

  const selection = await prompt(rl, "  ? Sections to configure: ");
  const keys = parseMenuSelection(selection);
  if (keys.length === 0) return;

  const toRun = keys.includes("all")
    ? [MENU.find((m) => m.key === "all")!]
    : keys.map((k) => MENU.find((m) => m.key === k)).filter((m): m is (typeof MENU)[number] => !!m);

  const unknown = keys.filter((k) => k !== "all" && !MENU.some((m) => m.key === k));
  if (unknown.length) {
    console.log(`  ⚠️  Unknown keys ignored: ${unknown.join(", ")}`);
  }

  for (const item of toRun) {
    console.log(`\n═══ ${item.label} ═══`);
    await item.run(rl);
  }
}

async function run(): Promise<void> {
  printBanner();

  const forceFull = process.argv.includes("--full");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    if (forceFull || !hasCosConfigFile()) {
      if (!hasCosConfigFile()) {
        console.log("No ~/.cos/config.json yet — running full setup.\n");
      } else {
        console.log("--full flag — running full setup wizard.\n");
      }
      await runFullWizard(rl);
    } else {
      console.log(
        "Config already exists — only selected sections will be updated.\n" +
          "Other settings are merged, not replaced. Use --full to walk every step.\n"
      );
      let again = true;
      while (again) {
        await runSelectiveSetup(rl);
        const more = await prompt(rl, "\n  Configure more sections? [y/N]: ");
        again = more.trim().toLowerCase() === "y";
      }
    }

    console.log("\n✅ Setup saved.");
    console.log("   Open this repo in Cursor → @bigboss brief me\n");
  } finally {
    rl.close();
  }
}

run().catch((err) => {
  console.error("[setup] fatal:", err);
  process.exit(1);
});
