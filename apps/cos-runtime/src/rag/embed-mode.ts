import { allowsFixtures, isMockEmbed } from "../config/env.js";
import { readCosConfig } from "../config/credentials.js";

/** CI fixture path only (COS_ALLOW_FIXTURES + COS_MOCK_EMBED). */
export function usesCiFixtureEmbed(): boolean {
  if (!allowsFixtures() && isMockEmbed()) {
    throw new Error(
      "COS_MOCK_EMBED is only allowed with COS_ALLOW_FIXTURES=true (CI). Use local RAG or configure cloud embeddings."
    );
  }
  return allowsFixtures() && isMockEmbed();
}

export function usesOpenSearchRag(): boolean {
  if (process.env["COS_RAG_BACKEND"] === "opensearch") return true;
  try {
    return readCosConfig().llm?.ragBackend === "opensearch";
  } catch {
    return false;
  }
}

/**
 * Local demo track: vectors stored in libSQL via deterministic hash embeddings.
 * Does not call Bedrock/OpenAI. Separate from CI fixture mocks.
 */
export function usesLocalHashEmbeddings(): boolean {
  if (usesCiFixtureEmbed()) return false;
  if (usesOpenSearchRag() && process.env["COS_OPENSEARCH_USE_LOCAL_EMBED"] === "true") return true;
  if (usesOpenSearchRag()) return false;
  try {
    const ragBackend = readCosConfig().llm?.ragBackend ?? "local";
    return ragBackend === "local";
  } catch {
    return true;
  }
}
