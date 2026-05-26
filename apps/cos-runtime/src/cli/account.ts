#!/usr/bin/env node
import "dotenv/config";
import {
  readCosConfig,
  listGoogleAccounts,
  listMicrosoftAccounts,
} from "../config/credentials.js";

async function run(): Promise<void> {
  const config = readCosConfig();

  console.log("\n=== BigBoss COS — Connected Accounts ===\n");

  if (config.ownerEmail) {
    console.log(`Owner: ${config.ownerEmail}`);
  }

  let n = 0;
  const lines: string[] = [];

  for (const a of listGoogleAccounts(config)) {
    n += 1;
    lines.push(`${n}. google  ${a.id}  (${a.label})`);
  }
  for (const a of listMicrosoftAccounts(config)) {
    n += 1;
    lines.push(`${n}. microsoft  ${a.id}  (${a.label})`);
  }
  if (config.asana?.pat) {
    n += 1;
    lines.push(`${n}. asana  (PAT configured)`);
  }
  if (config.telegram?.botToken && config.telegram?.chatId) {
    n += 1;
    lines.push(`${n}. telegram  (bot + chat configured)`);
  }
  if (config.llm?.provider) {
    n += 1;
    lines.push(`${n}. llm  (${config.llm.provider}${config.llm.auth ? "/" + config.llm.auth : ""})`);
  }

  if (lines.length === 0) {
    console.log("No accounts configured. Run setup first.");
    console.log("\nDisconnect: pnpm disconnect -- <google|microsoft|asana|telegram> [--id <account-id>]\n");
    return;
  }

  for (const line of lines) {
    console.log(line);
  }

  console.log("\nDisconnect: pnpm disconnect -- <google|microsoft|asana|telegram> [--id <account-id>]\n");
}

run().catch((err) => {
  console.error("[account] fatal:", err);
  process.exit(1);
});
