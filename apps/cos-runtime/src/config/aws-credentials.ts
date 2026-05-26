import { readCosConfig } from "./credentials.js";

type CredentialProvider = () => Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

export async function getAwsCredentials(): Promise<CredentialProvider> {
  const config = readCosConfig();
  const llm = config.llm;
  const { fromSSO, fromNodeProviderChain } = await import("@aws-sdk/credential-providers");

  if (llm?.provider === "bedrock" && llm.auth === "sso" && llm.awsSsoProfile) {
    return fromSSO({ profile: llm.awsSsoProfile }) as unknown as CredentialProvider;
  }

  if (llm?.provider === "bedrock" && llm.awsAccessKeyId && llm.awsSecretAccessKey) {
    const keyId = llm.awsAccessKeyId;
    const secret = llm.awsSecretAccessKey;
    return async () => ({ accessKeyId: keyId, secretAccessKey: secret });
  }

  return fromNodeProviderChain() as unknown as CredentialProvider;
}

export function getAwsRegion(): string {
  // Bootstrap env (collection region) wins over stale config when OpenSearch is active.
  if (process.env["COS_OPENSEARCH_ENDPOINT"] && process.env["AWS_REGION"]) {
    return process.env["AWS_REGION"];
  }
  const config = readCosConfig();
  return config.llm?.awsRegion ?? process.env["AWS_REGION"] ?? "us-east-2";
}
