import { applyCosRuntimeEnv } from "../config/runtime-env.js";
import { readCosConfig } from "../config/credentials.js";
import { getAwsCredentials, getAwsRegion } from "../config/aws-credentials.js";
import { usesOpenSearchRag } from "./embed-mode.js";

export interface AwsRagReadiness {
  bedrockConfigured: boolean;
  bedrockReachable: boolean;
  opensearchConfigured: boolean;
  opensearchReachable: boolean;
  errors: string[];
}

export async function checkAwsRagReadiness(livePing = true): Promise<AwsRagReadiness> {
  applyCosRuntimeEnv();
  const errors: string[] = [];
  let bedrockConfigured = false;
  let bedrockReachable = false;
  let opensearchConfigured = false;
  let opensearchReachable = false;

  try {
    const config = readCosConfig();
    const llm = config.llm;
    bedrockConfigured =
      llm?.provider === "bedrock" &&
      (llm.auth === "sso"
        ? Boolean(llm.awsSsoProfile)
        : Boolean(llm.awsAccessKeyId && llm.awsSecretAccessKey));

    if (!bedrockConfigured) {
      errors.push("Bedrock not configured in ~/.cos/config.json (pnpm setup → AI provider → Bedrock SSO)");
    }

    opensearchConfigured =
      llm?.ragBackend === "opensearch" && Boolean(llm.opensearchEndpoint?.trim());
    if (!opensearchConfigured) {
      errors.push(
        "OpenSearch RAG not configured (run ./scripts/bootstrap-aws-cos.sh --write-config or pnpm setup → AWS production bundle)",
      );
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return { bedrockConfigured, bedrockReachable, opensearchConfigured, opensearchReachable, errors };
  }

  if (!livePing) {
    return { bedrockConfigured, bedrockReachable, opensearchConfigured, opensearchReachable, errors };
  }

  if (bedrockConfigured) {
    try {
      const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
      const credentials = await getAwsCredentials();
      const sts = new STSClient({ region: getAwsRegion(), credentials });
      await sts.send(new GetCallerIdentityCommand({}));
      bedrockReachable = true;
    } catch (e) {
      errors.push(
        `AWS credentials failed (run: aws sso login --profile <your-profile>): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (opensearchConfigured && usesOpenSearchRag()) {
    try {
      const { ensureIndex } = await import("./opensearch-store.js");
      await ensureIndex();
      opensearchReachable = true;
    } catch (e) {
      errors.push(`OpenSearch unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { bedrockConfigured, bedrockReachable, opensearchConfigured, opensearchReachable, errors };
}
