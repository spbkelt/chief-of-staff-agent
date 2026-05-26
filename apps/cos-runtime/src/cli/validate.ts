#!/usr/bin/env node
import "dotenv/config";
import { getEnv } from "../config/env.js";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
}

// --no-live  skips actual API pings (use in CI where credentials aren't available)
const noLive = process.argv.includes("--no-live");

const REQUIRED_TABLES = ["nodes", "edges", "rag_sources", "rag_chunks", "rag_links", "sync_cursors"];

async function run(): Promise<void> {
  const env = getEnv();
  const results: CheckResult[] = [];

  results.push({ name: ".env loaded", status: "pass" });

  if (env.COS_OWNER_EMAIL) {
    results.push({ name: "COS_OWNER_EMAIL set", status: "pass", detail: env.COS_OWNER_EMAIL });
  } else {
    results.push({ name: "COS_OWNER_EMAIL set", status: "fail", detail: "not set" });
  }

  // ── libSQL schema ────────────────────────────────────────────────────────────
  results.push({ name: "COS_DB_PATH", status: "pass", detail: env.COS_DB_PATH });
  try {
    const { initSchema, getDb } = await import("../graph/graph.db.js");
    await initSchema();
    const db = getDb();
    const tableResult = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const existingTables = new Set(
      tableResult.rows.map((r) => r[0] as string)
    );
    const missing = REQUIRED_TABLES.filter((t) => !existingTables.has(t));
    if (missing.length === 0) {
      results.push({ name: "libSQL schema tables", status: "pass" });
    } else {
      results.push({
        name: "libSQL schema tables",
        status: "fail",
        detail: `missing: ${missing.join(", ")}`,
      });
    }
  } catch (err) {
    results.push({
      name: "libSQL schema tables",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Google OAuth ────────────────────────────────────────────────────────────
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    results.push({ name: "Google OAuth client credentials", status: "pass" });

    if (env.GOOGLE_ACCESS_TOKEN) {
      results.push({ name: "Google access token present", status: "pass" });

      if (!noLive) {
        try {
          const { getGoogleAuthClient, refreshGoogleTokenIfNeeded } = await import(
            "../auth/google-oauth.js"
          );
          const auth = getGoogleAuthClient();
          await refreshGoogleTokenIfNeeded(auth);
          results.push({ name: "Google token refresh", status: "pass" });
        } catch (err) {
          results.push({
            name: "Google token refresh",
            status: "fail",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        results.push({ name: "Google token refresh", status: "skip", detail: "--no-live" });
      }
    } else {
      results.push({
        name: "Google access token present",
        status: "skip",
        detail: "not set (run OAuth flow to obtain)",
      });
    }
  } else {
    results.push({
      name: "Google OAuth client credentials",
      status: "skip",
      detail: "not configured",
    });
  }

  // ── Asana PAT ───────────────────────────────────────────────────────────────
  if (env.ASANA_PAT) {
    results.push({ name: "Asana PAT present", status: "pass" });

    if (!noLive) {
      try {
        const resp = await fetch("https://app.asana.com/api/1.0/users/me", {
          headers: { Authorization: `Bearer ${env.ASANA_PAT}` },
        });
        if (resp.ok) {
          results.push({ name: "Asana PAT live ping", status: "pass" });
        } else {
          results.push({
            name: "Asana PAT live ping",
            status: "fail",
            detail: `HTTP ${resp.status}`,
          });
        }
      } catch (err) {
        results.push({
          name: "Asana PAT live ping",
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      results.push({ name: "Asana PAT live ping", status: "skip", detail: "--no-live" });
    }
  } else {
    results.push({ name: "Asana PAT present", status: "skip", detail: "not configured" });
  }

  // ── LLM backend (Bedrock) + AWS RAG ───────────────────────────────────────────
  try {
    const { readCosConfig } = await import("../config/credentials.js");
    const { checkAwsRagReadiness } = await import("../rag/aws-rag-check.js");
    const cosConfig = readCosConfig();
    const llm = cosConfig.llm;

    const bedrockViaKeys = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
    const bedrockViaSso =
      llm?.provider === "bedrock" && llm.auth === "sso" && Boolean(llm.awsSsoProfile);

    if (bedrockViaKeys) {
      results.push({ name: "AWS credentials (Bedrock keys)", status: "pass" });
    } else if (bedrockViaSso) {
      results.push({
        name: "AWS Bedrock (SSO profile)",
        status: "pass",
        ...(llm.awsSsoProfile ? { detail: llm.awsSsoProfile } : {}),
      });
    } else {
      results.push({
        name: "AWS credentials (Bedrock)",
        status: "skip",
        detail: "not configured (pnpm setup → Bedrock SSO or keys)",
      });
    }

    if (llm?.ragBackend === "opensearch") {
      if (llm.opensearchEndpoint) {
        results.push({
          name: "OpenSearch RAG endpoint",
          status: "pass",
          detail: llm.opensearchEndpoint.slice(0, 48) + "…",
        });
        if (!noLive) {
          const ragReady = await checkAwsRagReadiness(true);
          if (ragReady.opensearchReachable) {
            results.push({ name: "OpenSearch index reachable", status: "pass" });
          } else {
            results.push({
              name: "OpenSearch index reachable",
              status: "fail",
              detail: ragReady.errors.find((e) => e.includes("OpenSearch")) ?? "ping failed",
            });
          }
        } else {
          results.push({ name: "OpenSearch index reachable", status: "skip", detail: "--no-live" });
        }
      } else {
        results.push({
          name: "OpenSearch RAG endpoint",
          status: "fail",
          detail: "ragBackend=opensearch but opensearchEndpoint missing",
        });
      }
    } else {
      results.push({
        name: "AWS RAG backend",
        status: "skip",
        detail: `local libSQL (${llm?.ragBackend ?? "local"})`,
      });
    }

    if (!noLive && (bedrockViaSso || bedrockViaKeys)) {
      const ragReady = await checkAwsRagReadiness(true);
      if (ragReady.bedrockReachable) {
        results.push({ name: "AWS STS (Bedrock auth)", status: "pass" });
      } else if (!ragReady.bedrockConfigured) {
        results.push({ name: "AWS STS (Bedrock auth)", status: "skip" });
      } else {
        results.push({
          name: "AWS STS (Bedrock auth)",
          status: "fail",
          detail: ragReady.errors[0] ?? "sts failed",
        });
      }
    }
  } catch {
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      results.push({ name: "AWS credentials (Bedrock)", status: "pass" });
    } else {
      results.push({
        name: "AWS credentials (Bedrock)",
        status: "skip",
        detail: "not configured",
      });
    }
  }

  // ── Microsoft Graph (optional) ──────────────────────────────────────────────
  try {
    const { listMicrosoftAccounts } = await import("../config/credentials.js");
    const msAccounts = listMicrosoftAccounts();
    if (msAccounts.length === 0) {
      results.push({ name: "Microsoft accounts", status: "skip", detail: "not configured (optional)" });
    } else {
      for (const account of msAccounts) {
        if (!account.accessToken) {
          results.push({ name: `Microsoft: ${account.label}`, status: "skip", detail: "no access token — re-run setup" });
          continue;
        }
        if (!noLive) {
          try {
            const { refreshMicrosoftTokenIfNeeded, getMicrosoftAuthHeaders } = await import("../auth/microsoft-auth.js");
            const refreshed = await refreshMicrosoftTokenIfNeeded(account);
            const headers = getMicrosoftAuthHeaders(refreshed);
            const resp = await fetch("https://graph.microsoft.com/v1.0/me", {
              headers,
              signal: AbortSignal.timeout(8000),
            });
            if (resp.ok) {
              results.push({ name: `Microsoft: ${account.label}`, status: "pass" });
            } else {
              results.push({ name: `Microsoft: ${account.label}`, status: "fail", detail: `HTTP ${resp.status}` });
            }
          } catch (err) {
            results.push({ name: `Microsoft: ${account.label}`, status: "fail", detail: err instanceof Error ? err.message : String(err) });
          }
        } else {
          results.push({ name: `Microsoft: ${account.label}`, status: "skip", detail: "--no-live" });
        }
      }
    }
  } catch {
    results.push({ name: "Microsoft accounts", status: "skip", detail: "config unreadable" });
  }

  // ── Telegram (optional) ─────────────────────────────────────────────────────
  try {
    const { readCosConfig } = await import("../config/credentials.js");
    const cosConfig = readCosConfig();
    if (cosConfig.telegram?.botToken && cosConfig.telegram?.chatId) {
      if (!noLive) {
        try {
          const url = `https://api.telegram.org/bot${cosConfig.telegram.botToken}/getMe`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (resp.ok) {
            results.push({ name: "Telegram bot credentials", status: "pass" });
          } else {
            results.push({ name: "Telegram bot credentials", status: "fail", detail: `HTTP ${resp.status}` });
          }
        } catch (err) {
          results.push({ name: "Telegram bot credentials", status: "fail", detail: err instanceof Error ? err.message : String(err) });
        }
      } else {
        results.push({ name: "Telegram bot credentials", status: "skip", detail: "--no-live" });
      }
    } else {
      results.push({ name: "Telegram delivery", status: "skip", detail: "not configured (optional)" });
    }
  } catch {
    results.push({ name: "Telegram delivery", status: "skip", detail: "config unreadable" });
  }

  // ── LangSmith ───────────────────────────────────────────────────────────────
  if (env.LANGSMITH_API_KEY) {
    results.push({ name: "LangSmith API key", status: "pass" });

    if (!noLive && env.LANGSMITH_TRACING) {
      try {
        const resp = await fetch(env.LANGSMITH_ENDPOINT, {
          method: "HEAD",
          headers: { "x-api-key": env.LANGSMITH_API_KEY },
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok || resp.status === 405) {
          results.push({ name: "LangSmith endpoint reachable", status: "pass" });
        } else {
          results.push({
            name: "LangSmith endpoint reachable",
            status: "fail",
            detail: `HTTP ${resp.status}`,
          });
        }
      } catch (err) {
        results.push({
          name: "LangSmith endpoint reachable",
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      results.push({
        name: "LangSmith endpoint reachable",
        status: "skip",
        detail: noLive ? "--no-live" : "LANGSMITH_TRACING=false",
      });
    }
  } else {
    results.push({
      name: "LangSmith API key",
      status: "skip",
      detail: "optional — tracing disabled",
    });
  }

  // ── Print ────────────────────────────────────────────────────────────────────
  const pad = (s: string) => s.padEnd(44);
  console.log("\nValidation results:" + (noLive ? " (--no-live: API pings skipped)" : ""));
  console.log("─".repeat(66));
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭ ";
    const detail = r.detail ? `  (${r.detail})` : "";
    console.log(`${icon}  ${pad(r.name)}${detail}`);
  }
  console.log("─".repeat(66));

  const failed = results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll required checks passed.");
  }
}

run().catch((err) => {
  console.error("[validate] fatal:", err);
  process.exit(1);
});
