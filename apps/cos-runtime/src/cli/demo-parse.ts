export const DEFAULT_DEMO_QUERY =
  "What needs my attention today across email, calendar, and Asana?";

export const DEMO_USAGE = `Usage: pnpm demo [--skip-ingest] [--query "<question>"]

Env (optional):
  COS_OPENSEARCH_USE_LOCAL_EMBED=true  fast local vectors (recommended for demo)
  COS_DEMO_EMBED_MAX=40                cap Bedrock embeds per demo (0 = no limit)`;

export function parseDemoArgv(argv: string[]): { skipIngest: boolean; queryText: string } {
  let skipIngest = false;
  const queryParts: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--skip-ingest") {
      skipIngest = true;
      i++;
      continue;
    }
    if (arg === "--query") {
      i++;
      while (i < argv.length && argv[i] !== "--") {
        queryParts.push(argv[i]!);
        i++;
      }
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { skipIngest, queryText: "__HELP__" };
    }
    if (arg === "--") {
      i++;
      continue;
    }
    queryParts.push(arg);
    i++;
  }
  const queryText = queryParts.join(" ").trim() || DEFAULT_DEMO_QUERY;
  return { skipIngest, queryText };
}
