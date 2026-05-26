import type { LanguageModelV1, EmbeddingModelV1 } from "@ai-sdk/provider";
import { readCosConfig } from "../config/credentials.js";
import { getAwsCredentials, getAwsRegion } from "../config/aws-credentials.js";
import {
  DEFAULT_ANTHROPIC_LLM,
  DEFAULT_BEDROCK_EMBED,
  DEFAULT_BEDROCK_LLM,
  DEFAULT_OPENAI_EMBED,
  DEFAULT_OPENAI_LLM,
} from "./model-defaults.js";

export async function getLlmModel(): Promise<LanguageModelV1> {
  const config = readCosConfig();
  const llm = config.llm;
  const provider = llm?.provider ?? "bedrock";

  if (provider === "openai") {
    const apiKey = llm?.apiKey ?? process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OpenAI API key not configured. Run `pnpm setup` to configure.");
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey })(llm?.llmModel ?? DEFAULT_OPENAI_LLM);
  }

  if (provider === "anthropic") {
    const apiKey = llm?.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("Anthropic API key not configured. Run `pnpm setup` to configure.");
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey })(llm?.llmModel ?? DEFAULT_ANTHROPIC_LLM);
  }

  // Default: bedrock
  const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock");
  const credentials = await getAwsCredentials();
  return createAmazonBedrock({
    region: getAwsRegion(),
    bedrockOptions: { credentials },
  })(llm?.llmModel ?? DEFAULT_BEDROCK_LLM);
}

export async function getEmbeddingModel(): Promise<EmbeddingModelV1<string>> {
  const config = readCosConfig();
  const llm = config.llm;
  const provider = llm?.provider ?? "bedrock";

  // Anthropic has no embedding API — use embedProvider (openai) for embeddings
  if (provider === "anthropic" || llm?.embedProvider === "openai") {
    const apiKey = llm?.embedApiKey ?? process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OpenAI API key (for embeddings) not configured. Run `pnpm setup` to configure.");
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey }).embedding(llm?.embedModel ?? DEFAULT_OPENAI_EMBED);
  }

  if (provider === "openai") {
    const apiKey = llm?.apiKey ?? process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OpenAI API key not configured. Run `pnpm setup` to configure.");
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey }).embedding(llm?.embedModel ?? DEFAULT_OPENAI_EMBED);
  }

  // Default: bedrock (Cohere v4)
  const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock");
  const credentials = await getAwsCredentials();
  return createAmazonBedrock({
    region: getAwsRegion(),
    bedrockOptions: { credentials },
  }).embedding(llm?.embedModel ?? DEFAULT_BEDROCK_EMBED);
}
