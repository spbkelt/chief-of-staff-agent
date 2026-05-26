#!/usr/bin/env node
import "dotenv/config";
import { removeGoogleAccount, clearAsanaPat, clearTelegramConfig, listGoogleAccounts, readCosConfig, removeMicrosoftAccount, listMicrosoftAccounts } from "../config/credentials.js";

function usage(): void {
  console.log("Usage:");
  console.log("  pnpm disconnect -- google [--id <account-id>]");
  console.log("  pnpm disconnect -- asana");
  console.log("  pnpm disconnect -- telegram");
  console.log("  pnpm disconnect -- microsoft [--id <account-id>]");
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const target = args[0]?.toLowerCase();

  if (target === "google") {
    const idIdx = args.indexOf("--id");
    if (idIdx !== -1) {
      const id = args[idIdx + 1];
      if (!id) { console.error("--id requires a value"); process.exit(1); }
      removeGoogleAccount(id);
      console.log(`Removed Google account "${id}" from ~/.cos/config.json`);
    } else {
      const accounts = listGoogleAccounts(readCosConfig());
      if (accounts.length === 0) {
        console.log("No Google accounts configured.");
      } else if (accounts.length === 1) {
        removeGoogleAccount(accounts[0]!.id);
        console.log(`Removed Google account "${accounts[0]!.label}" from ~/.cos/config.json`);
      } else {
        console.log("Multiple Google accounts found. Specify --id <account-id>:");
        for (const a of accounts) console.log(`  ${a.id}  (${a.label})`);
        process.exit(1);
      }
    }
  } else if (target === "asana") {
    clearAsanaPat();
    console.log("Removed Asana PAT from ~/.cos/config.json");
  } else if (target === "telegram") {
    clearTelegramConfig();
    console.log("Removed Telegram credentials from ~/.cos/config.json");
  } else if (target === "microsoft") {
    const idIdx = args.indexOf("--id");
    if (idIdx !== -1) {
      const id = args[idIdx + 1];
      if (!id) { console.error("--id requires a value"); process.exit(1); }
      removeMicrosoftAccount(id);
      console.log(`Removed Microsoft account "${id}" from ~/.cos/config.json`);
    } else {
      const accounts = listMicrosoftAccounts(readCosConfig());
      if (accounts.length === 0) {
        console.log("No Microsoft accounts configured.");
      } else if (accounts.length === 1) {
        removeMicrosoftAccount(accounts[0]!.id);
        console.log(`Removed Microsoft account "${accounts[0]!.label}" from ~/.cos/config.json`);
      } else {
        console.log("Multiple Microsoft accounts found. Specify --id <account-id>:");
        for (const a of accounts) console.log(`  ${a.id}  (${a.label})`);
        process.exit(1);
      }
    }
  } else {
    usage();
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[disconnect] fatal:", err);
  process.exit(1);
});
