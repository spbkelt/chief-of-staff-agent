import { readCosConfig } from "./credentials.js";

/**
 * Apply ~/.cos/config.json backend selections to process.env for CLI runs.
 * Call at the start of ingest, query, embed, inspect, paths, and migrate CLIs.
 */
export function applyCosRuntimeEnv(): void {
  try {
    const config = readCosConfig();
    const llm = config.llm;
    const aws = config.aws;

    if (llm?.awsRegion) {
      process.env["AWS_REGION"] = llm.awsRegion;
      process.env["AWS_DEFAULT_REGION"] = llm.awsRegion;
    }
    if (aws?.region && !process.env["AWS_REGION"]) {
      process.env["AWS_REGION"] = aws.region;
      process.env["AWS_DEFAULT_REGION"] = aws.region;
    }

    if (llm?.provider === "bedrock" && llm.auth === "sso" && llm.awsSsoProfile) {
      process.env["AWS_PROFILE"] = llm.awsSsoProfile;
    }

    if (llm?.graphBackend === "dynamo") {
      process.env["COS_GRAPH_BACKEND"] = "dynamo";
      if (llm.dynamoTable) process.env["COS_DYNAMO_TABLE"] = llm.dynamoTable;
    }

    if (llm?.ragBackend === "opensearch") {
      process.env["COS_RAG_BACKEND"] = "opensearch";
      if (llm.opensearchEndpoint) {
        process.env["COS_OPENSEARCH_ENDPOINT"] = llm.opensearchEndpoint;
      }
    } else if (llm?.ragBackend === "local") {
      delete process.env["COS_RAG_BACKEND"];
    }
  } catch {
    // config missing — env vars only
  }
}
