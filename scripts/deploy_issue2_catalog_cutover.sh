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
