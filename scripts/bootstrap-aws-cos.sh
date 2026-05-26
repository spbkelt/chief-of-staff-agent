#!/usr/bin/env bash
#
# One-off demo: provision / tear down BigBoss COS AWS stack (KG + RAG + notify).
#   DynamoDB, S3, OpenSearch Serverless, IAM, Lambda, EventBridge, SQS.
#
#   aws sso login --profile cos-default
#   ./scripts/bootstrap-aws-cos.sh --profile cos-default --region us-east-1 --write-config
#   ./scripts/bootstrap-aws-cos.sh --destroy --yes --profile cos-default --region us-east-1
#   ./scripts/bootstrap-aws-cos.sh --dry-run
#
# Region must match your profile (cos-default → us-east-1). COS product default is us-east-2 if you use that elsewhere.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STAGE="${COS_STAGE:-dev}"
REGION="${AWS_REGION:-us-east-2}"
AWS_PROFILE="${AWS_PROFILE:-}"
AOSS_PUBLIC="${COS_BOOTSTRAP_AOSS_PUBLIC:-true}"
DRY_RUN=false
WRITE_CONFIG=false
MINIMAL=false
SKIP_LAMBDA_PACKAGE=false
DESTROY=false
DESTROY_YES=false
CLEAR_CONFIG=false

TABLE_NAME="cos-graph-${STAGE}"
IDEMPOTENCY_TABLE="cos-rag-idempotency-${STAGE}"
COLLECTION_NAME="cos-vectors-${STAGE}"
ENC_POLICY_NAME="cos-vectors-enc-${STAGE}"
NET_POLICY_NAME="cos-vectors-net-${STAGE}"
DATA_POLICY_NAME="cos-vectors-access-${STAGE}"
LAMBDA_NAME="cos-notification-push-${STAGE}"
EVENT_RULE_NAME="cos-notification-push-${STAGE}"
IAM_ROLE_NAME="cos-notification-push-${STAGE}"
LAMBDA_INLINE_POLICY_NAME="CosNotificationPushInline-${STAGE}"
OPERATOR_POLICY_NAME="CosBigBossOperator-${STAGE}"
SQS_DLQ_NAME="cos-rag-ingest-dlq-${STAGE}"

usage() {
  cat <<EOF
BigBoss COS — one-off AWS demo bootstrap

  aws sso login --profile cos-default
  ./scripts/bootstrap-aws-cos.sh --profile cos-default --region us-east-1 --write-config
  ./scripts/bootstrap-aws-cos.sh --destroy --yes --profile cos-default --region us-east-1

Options: --stage --region --profile --minimal --private-network
         --skip-lambda-package --write-config --dry-run
         --destroy --yes [--clear-config]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --profile) AWS_PROFILE="$2"; shift 2 ;;
    --private-network) AOSS_PUBLIC=false; shift ;;
    --minimal) MINIMAL=true; shift ;;
    --skip-lambda-package) SKIP_LAMBDA_PACKAGE=true; shift ;;
    --write-config) WRITE_CONFIG=true; shift ;;
    --destroy) DESTROY=true; shift ;;
    --yes) DESTROY_YES=true; shift ;;
    --clear-config) CLEAR_CONFIG=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$DESTROY" == true && "$DESTROY_YES" != true ]]; then
  echo "Refusing --destroy without --yes" >&2
  exit 1
fi

export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
[[ -n "$AWS_PROFILE" ]] && export AWS_PROFILE
AWS=(aws)
[[ -n "$AWS_PROFILE" ]] && AWS+=(--profile "$AWS_PROFILE")

log() { printf '\n▶ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }
need_bin() { command -v "$1" >/dev/null 2>&1 || die "Missing: $1"; }

run() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '[dry-run] '; printf '%q ' "$@"; printf '\n'
  else "$@"; fi
}

try_aws() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '[dry-run] '; printf '%q ' "$@"; printf '\n'; return 0
  fi
  "$@" 2>/dev/null || warn "Skipped: $*"
}

_aws_query_nonempty() { [[ -n "${1:-}" && "${1:-}" != "None" ]]; }

bucket_exists() { "${AWS[@]}" s3api head-bucket --bucket "$1" >/dev/null 2>&1; }
sqs_exists() { "${AWS[@]}" sqs get-queue-url --queue-name "$1" >/dev/null 2>&1; }
idempotency_table_exists() { "${AWS[@]}" dynamodb describe-table --table-name "$IDEMPOTENCY_TABLE" >/dev/null 2>&1; }
table_exists() { "${AWS[@]}" dynamodb describe-table --table-name "$TABLE_NAME" >/dev/null 2>&1; }

policy_exists() {
  local found
  found="$("${AWS[@]}" opensearchserverless list-security-policies --type "$1" \
    --query "securityPolicySummaries[?name=='$2'].name | [0]" --output text 2>/dev/null || true)"
  _aws_query_nonempty "$found"
}

access_policy_exists() {
  local found
  found="$("${AWS[@]}" opensearchserverless list-access-policies --type data \
    --query "accessPolicySummaries[?name=='${DATA_POLICY_NAME}'].name | [0]" --output text 2>/dev/null || true)"
  _aws_query_nonempty "$found"
}

collection_exists() {
  local found
  found="$("${AWS[@]}" opensearchserverless batch-get-collection --names "$COLLECTION_NAME" \
    --query "collectionDetails[0].name" --output text 2>/dev/null || true)"
  [[ "$found" == "$COLLECTION_NAME" ]]
}

if [[ "$DRY_RUN" == true ]]; then
  policy_exists() { return 1; }
  access_policy_exists() { return 1; }
  collection_exists() { return 1; }
  table_exists() { return 1; }
  bucket_exists() { return 1; }
  sqs_exists() { return 1; }
  idempotency_table_exists() { return 1; }
fi

wait_collection_active() {
  local i=0 status=""
  while [[ $i -lt 60 ]]; do
    status="$("${AWS[@]}" opensearchserverless batch-get-collection --names "$COLLECTION_NAME" \
      --query "collectionDetails[0].status" --output text 2>/dev/null || true)"
    [[ "$status" == "ACTIVE" ]] && return 0
    sleep 10; i=$((i + 1))
  done
  die "OpenSearch collection not ACTIVE (${status:-?})"
}

wait_collection_deleted() {
  local i=0
  while [[ $i -lt 60 ]]; do
    collection_exists || return 0
    sleep 10; i=$((i + 1))
  done
  warn "Collection still deleting"
}

create_s3_bucket() {
  local name="$1"
  bucket_exists "$name" && { warn "S3 ${name} exists"; return 0; }
  if [[ "$REGION" == "us-east-1" ]]; then
    run "${AWS[@]}" s3api create-bucket --bucket "$name"
  else
    run "${AWS[@]}" s3api create-bucket --bucket "$name" \
      --create-bucket-configuration "LocationConstraint=${REGION}"
  fi
  [[ "$DRY_RUN" == true ]] && return 0
  run "${AWS[@]}" s3api put-bucket-versioning --bucket "$name" \
    --versioning-configuration Status=Enabled
  run "${AWS[@]}" s3api put-public-access-block --bucket "$name" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  run "${AWS[@]}" s3api put-bucket-encryption --bucket "$name" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
}

create_sqs_dlq() {
  sqs_exists "$SQS_DLQ_NAME" && {
    SQS_DLQ_URL="$("${AWS[@]}" sqs get-queue-url --queue-name "$SQS_DLQ_NAME" --output text)"
    return 0
  }
  run "${AWS[@]}" sqs create-queue --queue-name "$SQS_DLQ_NAME" \
    --attributes MessageRetentionPeriod=1209600
  SQS_DLQ_URL="https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/${SQS_DLQ_NAME}"
  [[ "$DRY_RUN" != true ]] && SQS_DLQ_URL="$("${AWS[@]}" sqs get-queue-url --queue-name "$SQS_DLQ_NAME" --output text)"
}

create_idempotency_table() {
  idempotency_table_exists && return 0
  run "${AWS[@]}" dynamodb create-table --table-name "$IDEMPOTENCY_TABLE" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH
  [[ "$DRY_RUN" != true ]] && "${AWS[@]}" dynamodb wait table-exists --table-name "$IDEMPOTENCY_TABLE"
}

build_operator_policy_json() {
  jq -nc --arg region "$REGION" --arg account "$ACCOUNT_ID" \
    --arg graph "$TABLE_NAME" --arg idem "$IDEMPOTENCY_TABLE" \
    --arg corpus "$BUCKET_CORPUS" --arg ingest "$BUCKET_INGEST" --arg artifacts "$BUCKET_ARTIFACTS" \
    --arg collection "$1" --arg dlqname "$SQS_DLQ_NAME" \
    '{Version:"2012-10-17",Statement:[
      {Sid:"CosDynamo",Effect:"Allow",Action:["dynamodb:*"],Resource:[
        ("arn:aws:dynamodb:"+$region+":"+$account+":table/"+$graph),
        ("arn:aws:dynamodb:"+$region+":"+$account+":table/"+$graph+"/index/*"),
        ("arn:aws:dynamodb:"+$region+":"+$account+":table/"+$idem)]},
      {Sid:"CosAoss",Effect:"Allow",Action:["aoss:APIAccessAll"],Resource:[$collection]},
      {Sid:"CosBedrock",Effect:"Allow",Action:["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],Resource:"*"},
      {Sid:"CosS3",Effect:"Allow",Action:["s3:*"],Resource:[
        ("arn:aws:s3:::"+$corpus),("arn:aws:s3:::"+$corpus+"/*"),
        ("arn:aws:s3:::"+$ingest),("arn:aws:s3:::"+$ingest+"/*"),
        ("arn:aws:s3:::"+$artifacts),("arn:aws:s3:::"+$artifacts+"/*")]},
      {Sid:"CosSqs",Effect:"Allow",Action:["sqs:*"],Resource:("arn:aws:sqs:"+$region+":"+$account+":"+$dlqname)}
    ]}'
}

build_lambda_policy_json() {
  jq -nc --arg region "$REGION" --arg account "$ACCOUNT_ID" \
    --arg graph "$TABLE_NAME" --arg idem "$IDEMPOTENCY_TABLE" --arg corpus "$BUCKET_CORPUS" \
    --arg collection "$1" --arg dlq "$SQS_DLQ_NAME" \
    '{Version:"2012-10-17",Statement:[
      {Sid:"Dynamo",Effect:"Allow",Action:["dynamodb:GetItem","dynamodb:PutItem","dynamodb:Query","dynamodb:UpdateItem"],
        Resource:[("arn:aws:dynamodb:"+$region+":"+$account+":table/"+$graph),
          ("arn:aws:dynamodb:"+$region+":"+$account+":table/"+$graph+"/index/*"),
          ("arn:aws:dynamodb:"+$region+":"+$account+":table/"+$idem)]},
      {Sid:"Aoss",Effect:"Allow",Action:["aoss:APIAccessAll"],Resource:[$collection]},
      {Sid:"S3",Effect:"Allow",Action:["s3:GetObject","s3:ListBucket"],
        Resource:[("arn:aws:s3:::"+$corpus),("arn:aws:s3:::"+$corpus+"/*")]},
      {Sid:"Sqs",Effect:"Allow",Action:["sqs:SendMessage"],
        Resource:("arn:aws:sqs:"+$region+":"+$account+":"+$dlq)},
      {Sid:"Logs",Effect:"Allow",Action:["logs:*"],Resource:"*"}
    ]}'
}

ensure_operator_iam_policy() {
  local arn="arn:aws:iam::${ACCOUNT_ID}:policy/${OPERATOR_POLICY_NAME}"
  local doc; doc="$(build_operator_policy_json "$1")"
  if "${AWS[@]}" iam get-policy --policy-arn "$arn" >/dev/null 2>&1; then
    run "${AWS[@]}" iam create-policy-version --policy-arn "$arn" \
      --policy-document "$doc" --set-as-default
  else
    run "${AWS[@]}" iam create-policy --policy-name "$OPERATOR_POLICY_NAME" \
      --policy-document "$doc" --description "COS demo operator"
  fi
  OPERATOR_POLICY_ARN="$arn"
}

ensure_lambda_iam_role() {
  local trust='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  "${AWS[@]}" iam get-role --role-name "$IAM_ROLE_NAME" >/dev/null 2>&1 || \
    run "${AWS[@]}" iam create-role --role-name "$IAM_ROLE_NAME" \
      --assume-role-policy-document "$trust"
  LAMBDA_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${IAM_ROLE_NAME}"
  run "${AWS[@]}" iam put-role-policy --role-name "$IAM_ROLE_NAME" \
    --policy-name "$LAMBDA_INLINE_POLICY_NAME" --policy-document "$(build_lambda_policy_json "$1")"
}

ensure_aoss_data_access() {
  local lambda_role="${1:-}"
  local principals policy
  principals="$(jq -nc --arg c "$CALLER_ARN" --arg l "$lambda_role" \
    '[ $c ] + (if ($l|length)>0 then [$l] else [] end)')"
  policy="$(jq -nc --arg c "$COLLECTION_NAME" --argjson p "$principals" '[{Rules:[
    {ResourceType:"collection",Resource:["collection/"+$c],Permission:["aoss:*"]},
    {ResourceType:"index",Resource:["index/"+$c+"/*"],Permission:["aoss:*"]}
  ],Principal:$p}]')"
  if access_policy_exists && [[ "$DRY_RUN" != true ]]; then
    local ver out
    ver="$("${AWS[@]}" opensearchserverless get-access-policy --name "$DATA_POLICY_NAME" --type data \
      --query "accessPolicyDetail.policyVersion" --output text)"
    set +e
    out="$("${AWS[@]}" opensearchserverless update-access-policy --name "$DATA_POLICY_NAME" \
      --type data --policy-version "$ver" --policy "$policy" 2>&1)"
    local rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      if [[ "$out" == *"No changes detected"* ]]; then
        warn "AOSS data access policy unchanged"
      else
        die "update-access-policy failed: $out"
      fi
    fi
  else
    run "${AWS[@]}" opensearchserverless create-access-policy --name "$DATA_POLICY_NAME" \
      --type data --policy "$policy"
  fi
}

package_notification_lambda() {
  local out="${REPO_ROOT}/apps/cos-runtime/dist/lambda-bundle"
  local zip="${out}/notification-push.zip"
  local entry="${REPO_ROOT}/apps/cos-runtime/src/lambda/notification-push.ts"
  rm -rf "$out" && mkdir -p "$out"
  npx --yes esbuild@0.25.12 "$entry" --bundle --platform=node --target=node22 --format=cjs \
    --outfile="${out}/index.js" --external:@aws-sdk/* --external:@libsql/client \
    --external:googleapis --external:asana --external:langsmith --log-level=warning
  (cd "$out" && zip -q "$zip" index.js)
  echo "$zip"
}

wait_lambda_updated() {
  [[ "$DRY_RUN" == true ]] && return 0
  "${AWS[@]}" lambda wait function-updated --function-name "$LAMBDA_NAME"
}

deploy_notification_lambda() {
  local zip_path="${REPO_ROOT}/apps/cos-runtime/dist/lambda-bundle/notification-push.zip"
  if [[ "$SKIP_LAMBDA_PACKAGE" != true && "$DRY_RUN" != true ]]; then
    zip_path="$(package_notification_lambda)"
  elif [[ ! -f "$zip_path" ]]; then
    local t; t="$(mktemp -d)"
    printf 'exports.handler=async()=>({delivered:0,failed:0});' >"${t}/index.js"
    zip_path="${t}/fn.zip"; (cd "$t" && zip -q "$zip_path" index.js)
  fi
  local env="COS_GRAPH_BACKEND=dynamo,COS_DYNAMO_TABLE=${TABLE_NAME},COS_OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT},AWS_REGION_NAME=${REGION}"
  if "${AWS[@]}" lambda get-function --function-name "$LAMBDA_NAME" >/dev/null 2>&1; then
    run "${AWS[@]}" lambda update-function-code --function-name "$LAMBDA_NAME" --zip-file "fileb://${zip_path}"
    wait_lambda_updated
    run "${AWS[@]}" lambda update-function-configuration --function-name "$LAMBDA_NAME" \
      --role "$LAMBDA_ROLE_ARN" --environment "Variables={${env}}"
    wait_lambda_updated
  else
    run "${AWS[@]}" lambda create-function --function-name "$LAMBDA_NAME" --runtime nodejs22.x \
      --role "$LAMBDA_ROLE_ARN" --handler index.handler --zip-file "fileb://${zip_path}" \
      --timeout 300 --memory-size 512 --environment "Variables={${env}}"
  fi
  LAMBDA_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${LAMBDA_NAME}"
}

deploy_eventbridge_rule() {
  EVENT_RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${EVENT_RULE_NAME}"
  run "${AWS[@]}" events put-rule --name "$EVENT_RULE_NAME" \
    --schedule-expression "rate(15 minutes)" --state ENABLED 2>/dev/null || true
  try_aws "${AWS[@]}" lambda add-permission --function-name "$LAMBDA_NAME" \
    --statement-id "cos-eventbridge-${STAGE}" --action lambda:InvokeFunction \
    --principal events.amazonaws.com --source-arn "$EVENT_RULE_ARN"
  run "${AWS[@]}" events put-targets --rule "$EVENT_RULE_NAME" --targets "Id"="1","Arn"="${LAMBDA_ARN}"
}

seed_s3_prefixes() {
  [[ "$DRY_RUN" == true ]] && return 0
  local m; m="$(mktemp)"; echo ok >"$m"
  run "${AWS[@]}" s3api put-object --bucket "$BUCKET_CORPUS" --key "corpus/jsonl/.keep" --body "$m"
  run "${AWS[@]}" s3api put-object --bucket "$BUCKET_INGEST" --key "ingest/raw/.keep" --body "$m"
  run "${AWS[@]}" s3api put-object --bucket "$BUCKET_ARTIFACTS" --key "evidence/.keep" --body "$m"
  rm -f "$m"
}

destroy_eventbridge_and_lambda() {
  try_aws "${AWS[@]}" events remove-targets --rule "$EVENT_RULE_NAME" --ids "1"
  try_aws "${AWS[@]}" events delete-rule --name "$EVENT_RULE_NAME"
  try_aws "${AWS[@]}" lambda remove-permission --function-name "$LAMBDA_NAME" \
    --statement-id "cos-eventbridge-${STAGE}"
  try_aws "${AWS[@]}" lambda delete-function --function-name "$LAMBDA_NAME"
}

destroy_lambda_iam_role() {
  try_aws "${AWS[@]}" iam delete-role-policy --role-name "$IAM_ROLE_NAME" \
    --policy-name "$LAMBDA_INLINE_POLICY_NAME"
  [[ "$DRY_RUN" != true ]] && sleep 2
  try_aws "${AWS[@]}" iam delete-role --role-name "$IAM_ROLE_NAME"
}

destroy_opensearch_stack() {
  local col_id="$COLLECTION_NAME"
  collection_exists && col_id="$("${AWS[@]}" opensearchserverless batch-get-collection \
    --names "$COLLECTION_NAME" --query "collectionDetails[0].id" --output text)"
  try_aws "${AWS[@]}" opensearchserverless delete-collection --id "$col_id"
  [[ "$DRY_RUN" != true ]] && { wait_collection_deleted; sleep 5; }
  try_aws "${AWS[@]}" opensearchserverless delete-access-policy --name "$DATA_POLICY_NAME" --type data
  try_aws "${AWS[@]}" opensearchserverless delete-security-policy --name "$NET_POLICY_NAME" --type network
  try_aws "${AWS[@]}" opensearchserverless delete-security-policy --name "$ENC_POLICY_NAME" --type encryption
}

destroy_dynamodb_tables() {
  try_aws "${AWS[@]}" dynamodb delete-table --table-name "$TABLE_NAME"
  try_aws "${AWS[@]}" dynamodb delete-table --table-name "$IDEMPOTENCY_TABLE"
}

destroy_sqs_dlq() {
  sqs_exists "$SQS_DLQ_NAME" || return 0
  local url; url="$("${AWS[@]}" sqs get-queue-url --queue-name "$SQS_DLQ_NAME" --output text)"
  try_aws "${AWS[@]}" sqs delete-queue --queue-url "$url"
}

empty_and_delete_s3_bucket() {
  bucket_exists "$1" || return 0
  try_aws "${AWS[@]}" s3 rm "s3://$1" --recursive
  try_aws "${AWS[@]}" s3api delete-bucket --bucket "$1"
}

delete_iam_managed_policy() {
  local arn="arn:aws:iam::${ACCOUNT_ID}:policy/${OPERATOR_POLICY_NAME}"
  "${AWS[@]}" iam get-policy --policy-arn "$arn" >/dev/null 2>&1 || return 0
  if [[ "$DRY_RUN" != true ]]; then
    for v in $("${AWS[@]}" iam list-policy-versions --policy-arn "$arn" \
      --query 'Versions[?IsDefaultVersion==`false`].VersionId' --output text); do
      try_aws "${AWS[@]}" iam delete-policy-version --policy-arn "$arn" --version-id "$v"
    done
  fi
  try_aws "${AWS[@]}" iam delete-policy --policy-arn "$arn"
}

destroy_cascade() {
  log "DESTROY cascade (stage=${STAGE})"
  [[ "$MINIMAL" != true ]] && { destroy_eventbridge_and_lambda; destroy_lambda_iam_role; }
  destroy_opensearch_stack
  destroy_dynamodb_tables
  [[ "$MINIMAL" != true ]] && { destroy_sqs_dlq; empty_and_delete_s3_bucket "$BUCKET_CORPUS"
    empty_and_delete_s3_bucket "$BUCKET_INGEST"; empty_and_delete_s3_bucket "$BUCKET_ARTIFACTS"
    delete_iam_managed_policy; }
  [[ "$CLEAR_CONFIG" == true && "$DRY_RUN" != true ]] && {
    (cd "$REPO_ROOT" && pnpm exec tsx -e "
import { readCosConfig, writeCosConfig } from './apps/cos-runtime/src/config/credentials.ts';
const c = readCosConfig();
if (c.llm) { const {graphBackend:_g,dynamoTable:_t,ragBackend:_r,opensearchEndpoint:_o,...r}=c.llm; c.llm=Object.keys(r).length?r:undefined; }
delete c.aws; writeCosConfig(c);
") 2>/dev/null || true
  }
  rm -f "${HOME}/.cos/aws-bootstrap-${STAGE}.env"
  log "Destroy done"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
need_bin aws
need_bin jq

if [[ "$DRY_RUN" == true ]]; then
  ACCOUNT_ID="000000000000"
  CALLER_ARN="arn:aws:iam::000000000000:user/dry-run"
else
  ACCOUNT_ID="$("${AWS[@]}" sts get-caller-identity --query Account --output text)"
  CALLER_ARN="$("${AWS[@]}" sts get-caller-identity --query Arn --output text)"
fi
BUCKET_CORPUS="cos-rag-corpus-${STAGE}-${ACCOUNT_ID}"
BUCKET_INGEST="cos-rag-ingest-${STAGE}-${ACCOUNT_ID}"
BUCKET_ARTIFACTS="cos-rag-artifacts-${STAGE}-${ACCOUNT_ID}"
SQS_DLQ_URL=""

log "Account ${ACCOUNT_ID}"

if [[ "$DESTROY" == true ]]; then
  destroy_cascade
  exit 0
fi

[[ "$MINIMAL" != true ]] && {
  log "S3 + SQS + idempotency"
  create_s3_bucket "$BUCKET_CORPUS"
  create_s3_bucket "$BUCKET_INGEST"
  create_s3_bucket "$BUCKET_ARTIFACTS"
  create_sqs_dlq
  create_idempotency_table
}

log "DynamoDB ${TABLE_NAME}"
if ! table_exists; then
  GSI="$(mktemp)"
  jq -n '[{IndexName:"ownerUserId-nodeType-index",KeySchema:[{AttributeName:"ownerUserId",KeyType:"HASH"},{AttributeName:"nodeType",KeyType:"RANGE"}],Projection:{ProjectionType:"ALL"}}]' >"$GSI"
  run "${AWS[@]}" dynamodb create-table --table-name "$TABLE_NAME" --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    AttributeName=ownerUserId,AttributeType=S AttributeName=nodeType,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes "file://${GSI}"
  rm -f "$GSI"
  [[ "$DRY_RUN" != true ]] && "${AWS[@]}" dynamodb wait table-exists --table-name "$TABLE_NAME"
fi

log "OpenSearch ${COLLECTION_NAME}"
ENC="$(jq -nc --arg c "$COLLECTION_NAME" '{Rules:[{ResourceType:"collection",Resource:["collection/"+$c]}],AWSOwnedKey:true}')"
policy_exists encryption "$ENC_POLICY_NAME" || run "${AWS[@]}" opensearchserverless create-security-policy \
  --name "$ENC_POLICY_NAME" --type encryption --policy "$ENC"
if [[ "$AOSS_PUBLIC" == true ]]; then
  NET="$(jq -nc --arg c "$COLLECTION_NAME" '[{Rules:[{ResourceType:"collection",Resource:["collection/"+$c]},{ResourceType:"dashboard",Resource:["collection/"+$c]}],AllowFromPublic:true}]')"
else
  NET="$(jq -nc --arg c "$COLLECTION_NAME" '[{Rules:[{ResourceType:"collection",Resource:["collection/"+$c]},{ResourceType:"dashboard",Resource:["collection/"+$c]}],AllowFromPublic:false}]')"
fi
policy_exists network "$NET_POLICY_NAME" || run "${AWS[@]}" opensearchserverless create-security-policy \
  --name "$NET_POLICY_NAME" --type network --policy "$NET"
collection_exists || run "${AWS[@]}" opensearchserverless create-collection --name "$COLLECTION_NAME" --type VECTORSEARCH
[[ "$DRY_RUN" != true ]] && wait_collection_active

if [[ "$DRY_RUN" == true ]]; then
  OPENSEARCH_ENDPOINT="https://${COLLECTION_NAME}.${REGION}.aoss.amazonaws.com"
  COLLECTION_ARN="arn:aws:aoss:${REGION}:${ACCOUNT_ID}:collection/${COLLECTION_NAME}"
else
  OPENSEARCH_ENDPOINT="$("${AWS[@]}" opensearchserverless batch-get-collection --names "$COLLECTION_NAME" \
    --query "collectionDetails[0].collectionEndpoint" --output text)"
  COLLECTION_ARN="$("${AWS[@]}" opensearchserverless batch-get-collection --names "$COLLECTION_NAME" \
    --query "collectionDetails[0].arn" --output text)"
fi

LAMBDA_ARN="" EVENT_RULE_ARN="" OPERATOR_POLICY_ARN="" LAMBDA_ROLE_ARN=""
if [[ "$MINIMAL" != true ]]; then
  ensure_lambda_iam_role "$COLLECTION_ARN"
  ensure_aoss_data_access "$LAMBDA_ROLE_ARN"
  ensure_operator_iam_policy "$COLLECTION_ARN"
  deploy_notification_lambda
  deploy_eventbridge_rule
  seed_s3_prefixes
else
  ensure_aoss_data_access ""
fi

ENV_FILE="${HOME}/.cos/aws-bootstrap-${STAGE}.env"
if [[ "$DRY_RUN" != true ]]; then
  mkdir -p "${HOME}/.cos"
  cat >"$ENV_FILE" <<EOF
export AWS_REGION=${REGION}
export COS_STAGE=${STAGE}
export COS_GRAPH_BACKEND=dynamo
export COS_RAG_BACKEND=opensearch
export COS_DYNAMO_TABLE=${TABLE_NAME}
export COS_OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}
export COS_RAG_CORPUS_BUCKET=${BUCKET_CORPUS}
export COS_RAG_INGEST_BUCKET=${BUCKET_INGEST}
export COS_RAG_ARTIFACTS_BUCKET=${BUCKET_ARTIFACTS}
export COS_RAG_IDEMPOTENCY_TABLE=${IDEMPOTENCY_TABLE}
EOF
  [[ -n "${SQS_DLQ_URL:-}" ]] && echo "export COS_RAG_INGEST_DLQ_URL=${SQS_DLQ_URL}" >>"$ENV_FILE"
  [[ -n "$OPERATOR_POLICY_ARN" ]] && echo "export COS_OPERATOR_POLICY_ARN=${OPERATOR_POLICY_ARN}" >>"$ENV_FILE"
  [[ -n "$AWS_PROFILE" ]] && echo "export AWS_PROFILE=${AWS_PROFILE}" >>"$ENV_FILE"
fi

[[ "$WRITE_CONFIG" == true && "$DRY_RUN" != true ]] && {
  (cd "$REPO_ROOT" && export TABLE_NAME OPENSEARCH_ENDPOINT STAGE REGION COLLECTION_ARN \
    BUCKET_CORPUS BUCKET_INGEST BUCKET_ARTIFACTS IDEMPOTENCY_TABLE OPERATOR_POLICY_ARN \
    LAMBDA_ARN EVENT_RULE_ARN SQS_DLQ_URL="${SQS_DLQ_URL:-}" && pnpm exec tsx -e "
import { mergeCosConfig, readCosConfig } from './apps/cos-runtime/src/config/credentials.ts';
const e = readCosConfig();
mergeCosConfig({ llm: { ...(e.llm??{provider:'bedrock'}), graphBackend:'dynamo', dynamoTable:process.env.TABLE_NAME, ragBackend:'opensearch', opensearchEndpoint:process.env.OPENSEARCH_ENDPOINT, awsRegion:process.env.REGION }, aws: { ...(e.aws??{}), stage:process.env.STAGE, region:process.env.REGION, corpusBucket:process.env.BUCKET_CORPUS, ingestBucket:process.env.BUCKET_INGEST, artifactsBucket:process.env.BUCKET_ARTIFACTS, idempotencyTable:process.env.IDEMPOTENCY_TABLE, opensearchCollectionArn:process.env.COLLECTION_ARN, operatorPolicyArn:process.env.OPERATOR_POLICY_ARN, notificationLambdaArn:process.env.LAMBDA_ARN, eventBridgeRuleArn:process.env.EVENT_RULE_ARN, ingestDlqUrl:process.env.SQS_DLQ_URL||e.aws?.ingestDlqUrl } });
")
}

cat <<EOF

✅ Done.  source ${ENV_FILE}
   Destroy: ./scripts/bootstrap-aws-cos.sh --destroy --yes --profile ${AWS_PROFILE:-default}
   Policy:  ${OPERATOR_POLICY_ARN:-n/a} (SSO: add via Permission set, or skip if AdministratorAccess)

EOF
