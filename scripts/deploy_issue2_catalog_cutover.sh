#!/usr/bin/env bash
set -euo pipefail

EXPECTED_REMOTE_MAIN="f982ee84ea2fbc8b0dab75c690d45abcab7fc8d0"
EXPECTED_RULES_SHA256="b37345ded4ff99220a8673c68ca9f864b784d7fbdecd4eeba0bbb0426c4639e0"
PROJECT_ID="starbucks-helper-f578e"
PAGES_BASE="https://runipokr-dotcom.github.io/STARBUCKS-HELPER"
CONSOLE_RULES_URL="https://console.firebase.google.com/project/$PROJECT_ID/firestore/databases/-default-/security/rules"
REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "$REPO_ROOT"

if [[ "$(git branch --show-current)" != "codex/issue2-catalog-cutover-stage" ]]; then
  echo "중단: codex/issue2-catalog-cutover-stage 브랜치에서만 실행할 수 있습니다." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "중단: 작업트리가 clean이 아닙니다." >&2
  exit 1
fi

actual_rules_hash="$(shasum -a 256 firestore.catalog-phase1.rules | awk '{print $1}')"
if [[ "$actual_rules_hash" != "$EXPECTED_RULES_SHA256" ]]; then
  echo "중단: Console에 게시할 catalog-only Rules 파일 hash가 검증본과 다릅니다." >&2
  exit 1
fi

cat <<'EOF'
중간 영향 안내:
- 정적 push 즉시 새 share.html은 기존 c6xxh9 문서로 286상품을 계속 표시하지만 offer는 화면·수신 메모리에서 제거합니다.
- 정적 push 후 adminCatalogs 복사 전까지 catalog editor와 견적서의 상품 불러오기가 일시적으로 사용 불가합니다.
- Console Rules 게시 후 sale-only 게시 전까지 raw c6xxh9 문서의 offer 286건은 아직 exact 공개 read가 가능합니다.
- Rules 게시 후 legacy workspace는 owner read-only로 잠기고, 기존 주문 subcollection과 견적 문서 4개는 보존됩니다.
- 배포 전부터 열려 있던 이전 공개 페이지는 새로고침 전까지 이전 코드를 실행할 수 있고, offer 주문은 새 Rules에서 거부됩니다.
EOF
read -r -p "위 중간 영향을 확인했고 Console Rules 게시와 owner helper 1·2단계를 연속 수행할 준비가 됐습니까? 계속하려면 YES: " impact_ack
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
  echo "중단: Pages 파일 해시가 5분 안에 준비본과 일치하지 않았습니다. Console Rules를 게시하지 마세요." >&2
  exit 1
fi

cat <<EOF
정적 파일 push·Pages hash readback 완료

이 terminal을 그대로 열어 두고 Work에 Pages hash readback 완료를 알리세요.
사용자가 정확한 적용 시점을 명시적으로 승인한 뒤 Work가 기존 owner Firebase Console 세션에서 아래 작업을 수행합니다.
1. $CONSOLE_RULES_URL
2. $REPO_ROOT/firestore.catalog-phase1.rules 전체 206줄로 현재 Rules 전체 교체
3. 파일 SHA-256 $EXPECTED_RULES_SHA256 재대조
4. Firebase Console 게시 후 Console 상태와 익명 권한 경계 1차 READBACK

Cloud Shell·새 로그인·API 승인·새 권한 요청이 나타나면 수락하지 않고 중단합니다.
EOF
read -r -p "Work가 Console 게시와 1차 READBACK 성공을 보고한 뒤 RULES_PUBLISHED를 입력: " rules_ack
if [[ "$rules_ack" != "RULES_PUBLISHED" ]]; then
  echo "중단: Rules 게시 확인이 없습니다. owner helper를 실행하지 마세요." >&2
  exit 1
fi

api_key="AIzaSyAQpr3_koSKTAfihI8E3-kW3PknfMrQdaA"
rest_base="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents"
status_of() {
  curl -sS -o /dev/null -w '%{http_code}' "$rest_base/$1?key=$api_key"
}

rules_ready=false
for _ in {1..24}; do
  public_status="$(status_of 'catalogShares/c6xxh9')"
  legacy_status="$(status_of 'catalogShares/work-k4m8q2x7n9v3c6p5r8t1')"
  quote_status="$(status_of 'catalogShares/quote-current-v1')"
  if [[ "$public_status" == "200" && "$legacy_status" == "403" && "$quote_status" == "403" ]]; then
    rules_ready=true
    break
  fi
  sleep 5
done
if [[ "$rules_ready" != true ]]; then
  echo "중단: Console 게시 후 catalog-only Rules 익명 상태코드 대조 실패 (public=$public_status legacy=$legacy_status quote=$quote_status). 데이터를 쓰지 마세요." >&2
  exit 1
fi

echo "정적 파일과 catalog-only Rules 게시·readback 완료"
echo "지금 바로 $PAGES_BASE/issue2-catalog-cutover.html 에서 기존 owner 세션으로 1번 복사·대조 후 2번 sale-only 게시·대조를 연속 실행하세요."
