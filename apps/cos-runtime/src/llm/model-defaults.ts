/**
 * Default model IDs when config/env omit llmModel / embedModel.
 * Bedrock: Sonnet 4.6 + Cohere Embed v4 (1024-dim, matches OpenSearch knn_vector).
 * OpenAI / Anthropic API: current generation chat + embedding models.
 */
export const DEFAULT_BEDROCK_LLM = "anthropic.claude-sonnet-4-6";
export const DEFAULT_BEDROCK_EMBED = "cohere.embed-v4:0";
export const DEFAULT_OPENAI_LLM = "gpt-5-mini";
export const DEFAULT_OPENAI_EMBED = "text-embedding-3-large";
export const DEFAULT_ANTHROPIC_LLM = "claude-sonnet-4-6";
