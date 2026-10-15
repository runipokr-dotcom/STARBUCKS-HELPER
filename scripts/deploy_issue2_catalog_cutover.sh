#!/usr/bin/env bash
set -euo pipefail

EXPECTED_REMOTE_MAIN="f982ee84ea2fbc8b0dab75c690d45abcab7fc8d0"
PROJECT_ID="starbucks-helper-f578e"
PAGES_BASE="https://runipokr-dotcom.github.io/STARBUCKS-HELPER"
REPO_ROOT="$(git rev-parse --show-toplevel)"
FIREBASE_BIN="${FIREBASE_BIN:-$REPO_ROOT/node_modules/.bin/firebase}"
if [[ ! -x "$FIREBASE_BIN" ]]; then
  FIREBASE_BIN="/Users/kangsik/Downloads/2026-10-14/task/node_modules/.bin/firebase"
fi
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  NODE_BIN="/opt/homebrew/opt/node@24/bin/node"
fi

cd "$REPO_ROOT"

if [[ "$(git branch --show-current)" != "codex/issue2-catalog-cutover-stage" ]]; then
  echo "중단: codex/issue2-catalog-cutover-stage 브랜치에서만 실행할 수 있습니다." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "중단: 작업트리가 clean이 아닙니다." >&2
  exit 1
fi
if [[ ! -x "$FIREBASE_BIN" ]]; then
  echo "중단: 기존 Firebase CLI 설치를 찾을 수 없습니다. 새 설치나 로그인을 만들지 않습니다." >&2
  exit 1
fi
if [[ ! -x "$NODE_BIN" ]]; then
  echo "중단: 기존 Node.js 실행 파일을 찾을 수 없습니다." >&2
  exit 1
fi
FIREBASE_TOOLS_DIR="$(cd "$(dirname "$FIREBASE_BIN")/../firebase-tools" && pwd)"

# A missing Firebase CLI session used to be discovered only after the GitHub
# push. Keep every external change behind a read-only authentication and
# project-visibility preflight. These checks never create an account, token,
# role, or project permission.
has_authorized_account() {
  "$NODE_BIN" -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(input);
        const accounts = Array.isArray(parsed.result) ? parsed.result : [];
        process.exit(accounts.length > 0 ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  '
}

can_see_target_project() {
  "$NODE_BIN" -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(input);
        const projects = Array.isArray(parsed.result) ? parsed.result : [];
        process.exit(projects.some(project =>
          project && project.projectId === process.argv[1]
        ) ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  ' "$PROJECT_ID"
}

has_rules_deploy_permissions() {
  FIREBASE_TOOLS_DIR="$FIREBASE_TOOLS_DIR" "$NODE_BIN" - "$PROJECT_ID" <<'NODE'
const base = process.env.FIREBASE_TOOLS_DIR;
const projectId = process.argv[2];
const auth = require(`${base}/lib/auth`);
const { requireAuth } = require(`${base}/lib/requireAuth`);
const iam = require(`${base}/lib/gcp/iam`);

const required = [
  "firebase.projects.get",
  "firebaserules.releases.create",
  "firebaserules.releases.get",
  "firebaserules.releases.list",
  "firebaserules.releases.update",
  "firebaserules.rulesets.create",
  "firebaserules.rulesets.get",
  "firebaserules.rulesets.list",
  "firebaserules.rulesets.test",
  "datastore.indexes.create",
  "datastore.indexes.delete",
  "datastore.indexes.list",
  "datastore.indexes.update",
];

(async () => {
  const account = auth.getGlobalDefaultAccount();
  if (!account) process.exit(1);
  const options = {
    project: projectId,
    user: account.user,
    tokens: account.tokens,
  };
  auth.setActiveAccount(options, account);
  await requireAuth(options);
  const result = await iam.testIamPermissions(projectId, required);
  process.exit(result.passed ? 0 : 1);
})().catch(() => process.exit(1));
NODE
}

if ! "$FIREBASE_BIN" login:list --json 2>/dev/null | has_authorized_account; then
  echo "중단: Firebase CLI에 인증된 계정이 없습니다. GitHub push는 시작하지 않았습니다." >&2
  echo "'$FIREBASE_BIN login'은 기존 Firebase 관리자 Google 계정의 로컬 OAuth 세션을 생성하므로 별도 사용자 승인 전에 실행하지 마세요." >&2
  exit 1
fi
if ! "$FIREBASE_BIN" projects:list --json 2>/dev/null | can_see_target_project; then
  echo "중단: 현재 Firebase CLI 계정으로 대상 프로젝트를 조회할 수 없습니다. GitHub push는 시작하지 않았습니다." >&2
  echo "새 권한을 요청하지 말고 기존 Firebase 관리자 계정이 맞는지 사용자가 확인하세요." >&2
  exit 1
fi
if ! has_rules_deploy_permissions; then
  echo "중단: 현재 Firebase CLI 계정의 Rules 배포 필수 IAM 권한을 읽기 전용으로 확인하지 못했습니다. GitHub push는 시작하지 않았습니다." >&2
  echo "새 권한을 요청하지 말고 기존 Firebase 관리자 계정이 맞는지 사용자가 확인하세요." >&2
  exit 1
fi

cat <<'EOF'
중간 영향 안내:
- 새 share.html이 먼저 배포되면 기존 c6xxh9 문서로 286상품을 계속 표시하지만 offer는 화면·수신 메모리에서 제거됩니다.
- Rules 배포 후 sale-only 게시 전까지 raw c6xxh9 문서의 offer 286건은 아직 남아 있으며 exact 공개 read가 가능합니다.
- 그 구간에 legacy workspace는 owner read-only로 잠기고, adminCatalogs 복사 전에는 catalog editor와 견적서의 상품 불러오기가 일시적으로 사용 불가합니다.
- 배포 전부터 열려 있던 이전 공개 페이지는 새로고침 전까지 이전 코드를 실행할 수 있고, offer 주문은 새 Rules에서 거부됩니다.
EOF
read -r -p "위 중간 영향을 확인했고 이어서 owner helper 1·2단계를 즉시 수행할 준비가 됐습니까? 계속하려면 YES: " impact_ack
if [[ "$impact_ack" != "YES" ]]; then
  echo "중단: 사용자 확인 전이므로 GitHub push를 시작하지 않았습니다." >&2
  exit 1
fi

remote_main="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [[ "$remote_main" != "$EXPECTED_REMOTE_MAIN" ]]; then
  echo "중단: 원격 main이 검증 기준에서 변경됐습니다. 현재 $remote_main" >&2
  exit 1
fi

expected_files="$(cat <<'EOF'
START_HERE.md
WORKLOG.md
catalog-cutover-core.js
catalog-editor.html
catalog-sync.js
firebase-admin-auth.js
firebase.catalog-phase1.json
firestore.catalog-phase1.rules
issue2-catalog-cutover.html
quote.html
scripts/deploy_issue2_catalog_cutover.sh
share.html
EOF
)"
actual_files="$(git diff --name-only "$EXPECTED_REMOTE_MAIN"...HEAD | LC_ALL=C sort)"
if [[ "$actual_files" != "$expected_files" ]]; then
  echo "중단: 최소 허용 목록 밖의 변경이 있습니다." >&2
  diff -u <(printf '%s\n' "$expected_files") <(printf '%s\n' "$actual_files") || true
  exit 1
fi

git push origin HEAD:main
deployed_commit="$(git rev-parse HEAD)"
remote_after="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [[ "$remote_after" != "$deployed_commit" ]]; then
  echo "중단: push 후 원격 main readback이 일치하지 않습니다." >&2
  exit 1
fi

declare -A expected_hashes=(
  [share.html]="a7c34b9a693d3e8dcb5ba6bb859210c572dac33051f5259f39642ca7c04dba52"
  [catalog-editor.html]="a2fb3515a804415a019aa0a4d5615ccb096216c4b2cf0998cc4779c2461e73d1"
  [catalog-sync.js]="2c56d1b155257dec56b3819b13b8b983e08bd629e3e618454780525802b15c03"
  [firebase-admin-auth.js]="e28d18fcc758b6021b48962d396b15b9b46807f78d87c609550a6c53501c42d5"
  [quote.html]="872b06679ca1cb1405b166815bf449bf3925b7fafde4d6501153625ef61fdd55"
  [catalog-cutover-core.js]="0960d9ce996595fe96b6cdc1bd11493b05832c378950ad8d34d9a967a0151393"
  [issue2-catalog-cutover.html]="893536f03a4b6008df41e766699ce644d4f07bb05d4691f334881efa60beae89"
  [catalog-backup-core.js]="e1472d85687ee6037ac6d19ece0e7c1d422547d2641878a608767bcec72c3f3b"
)

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT
pages_ready=false
for _ in {1..60}; do
  pages_ready=true
  for path in "${!expected_hashes[@]}"; do
    if ! curl -fsSL "$PAGES_BASE/$path" -o "$temp_dir/$(basename "$path")"; then
      pages_ready=false
      break
    fi
    actual_hash="$(shasum -a 256 "$temp_dir/$(basename "$path")" | awk '{print $1}')"
    if [[ "$actual_hash" != "${expected_hashes[$path]}" ]]; then
      pages_ready=false
      break
    fi
  done
  if [[ "$pages_ready" == true ]]; then break; fi
  sleep 5
done
if [[ "$pages_ready" != true ]]; then
  echo "중단: Pages 파일 해시가 5분 안에 준비본과 일치하지 않았습니다. Rules는 배포하지 않았습니다." >&2
  exit 1
fi

PATH="/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/opt/node@24/bin:/usr/bin:/bin" \
  "$FIREBASE_BIN" deploy \
    --only firestore:rules \
    --project "$PROJECT_ID" \
    --config firebase.catalog-phase1.json

api_key="AIzaSyAQpr3_koSKTAfihI8E3-kW3PknfMrQdaA"
rest_base="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents"
status_of() {
  curl -sS -o /dev/null -w '%{http_code}' "$rest_base/$1?key=$api_key"
}

public_status="$(status_of 'catalogShares/c6xxh9')"
legacy_status="$(status_of 'catalogShares/work-k4m8q2x7n9v3c6p5r8t1')"
quote_status="$(status_of 'catalogShares/quote-current-v1')"
server3_status="$(status_of 'privateCouponData/server3')"
if [[ "$public_status" != "200" || "$legacy_status" != "403" || "$quote_status" != "403" || "$server3_status" != "403" ]]; then
  echo "중단: Rules 익명 상태코드 대조 실패 (public=$public_status legacy=$legacy_status quote=$quote_status server3=$server3_status). 데이터 쓰기는 실행하지 마세요." >&2
  exit 1
fi

echo "정적 파일과 catalog-only Rules 배포·readback 완료"
echo "다음 단계: $PAGES_BASE/issue2-catalog-cutover.html 에서 기존 owner 세션으로 1번 복사·대조 후 2번 sale-only 게시·대조"
