#!/usr/bin/env bash
set -euo pipefail

EXPECTED_REMOTE_MAIN="f2bf495e90e4b2ce0d83963e13657900f12606f1"
EXPECTED_BRANCH="codex/issue2-partner-entry-stage"
PARTNER_SHA256="19be50d9bfbc302c9c015ee57202950afc9b2e12e325425a50787c03048af322"
PUBLIC_SHARE_SHA256="a7c34b9a693d3e8dcb5ba6bb859210c572dac33051f5259f39642ca7c04dba52"
PAGES_BASE="https://runipokr-dotcom.github.io/STARBUCKS-HELPER"
REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "$REPO_ROOT"

if [[ "$(git branch --show-current)" != "$EXPECTED_BRANCH" ]]; then
  echo "중단: $EXPECTED_BRANCH 브랜치에서만 실행할 수 있습니다." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "중단: 작업트리가 clean이 아닙니다." >&2
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
partner.html
scripts/deploy_issue2_partner_entry.sh
tests/partner-entry.static.test.mjs
tests/share.partner-lifecycle.browser.test.mjs
EOF
)"
actual_files="$(git diff --name-only "$EXPECTED_REMOTE_MAIN"...HEAD | LC_ALL=C sort)"
if [[ "$actual_files" != "$expected_files" ]]; then
  echo "중단: 거래처 진입점 최소 허용 목록 밖의 변경이 있습니다." >&2
  diff -u <(printf '%s\n' "$expected_files") <(printf '%s\n' "$actual_files") || true
  exit 1
fi

if [[ "$(shasum -a 256 partner.html | awk '{print $1}')" != "$PARTNER_SHA256" ]]; then
  echo "중단: partner.html hash가 검증본과 다릅니다." >&2
  exit 1
fi
if [[ "$(shasum -a 256 share.html | awk '{print $1}')" != "$PUBLIC_SHARE_SHA256" ]]; then
  echo "중단: 기존 공개 share.html이 기준본과 다릅니다." >&2
  exit 1
fi

node --test \
  tests/partner-entry.static.test.mjs \
  tests/share.partner-lifecycle.browser.test.mjs

cat <<'EOF'
중간 영향 안내:
- 기존 공개 URL share.html?id=c6xxh9와 공개 상품 문서는 변경하지 않습니다.
- 신규 partner.html은 fragment capability를 기존 share.html viewer에 전달하는 정적 진입점만 제공합니다.
- capability, partner 문서, Auth, Rules, Firestore 데이터는 생성하거나 변경하지 않습니다.
- 이미 활성화된 유효 capability가 존재한다면 해당 링크 소지자는 배포 직후 partner.html로 접근할 수 있습니다.
- 문제가 있으면 이 commit을 revert해 정적 진입점을 제거할 수 있지만, 별도 partner 문서가 존재한다면 정적 파일 제거만으로 서버 접근 권한이 회수되지는 않습니다.
EOF
read -r -p "위 영향을 확인했고 이 정적 진입점만 배포합니까? 계속하려면 YES: " impact_ack
if [[ "$impact_ack" != "YES" ]]; then
  echo "중단: 사용자 확인 전이므로 GitHub push를 시작하지 않았습니다." >&2
  exit 1
fi

git push origin HEAD:main
deployed_commit="$(git rev-parse HEAD)"
remote_after="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
if [[ "$remote_after" != "$deployed_commit" ]]; then
  echo "중단: push 후 원격 main readback이 일치하지 않습니다." >&2
  exit 1
fi

paths=("partner.html" "share.html?id=c6xxh9")
hashes=("$PARTNER_SHA256" "$PUBLIC_SHARE_SHA256")
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

pages_ready=false
for _ in $(seq 1 60); do
  pages_ready=true
  index=0
  while [[ "$index" -lt "${#paths[@]}" ]]; do
    if ! curl -fsSL "$PAGES_BASE/${paths[$index]}" -o "$temp_dir/page-$index"; then
      pages_ready=false
      break
    fi
    actual_hash="$(shasum -a 256 "$temp_dir/page-$index" | awk '{print $1}')"
    if [[ "$actual_hash" != "${hashes[$index]}" ]]; then
      pages_ready=false
      break
    fi
    index=$((index + 1))
  done
  if [[ "$pages_ready" == true ]]; then break; fi
  sleep 5
done

if [[ "$pages_ready" != true ]]; then
  echo "중단: Pages partner/public 파일 hash가 5분 안에 준비본과 일치하지 않았습니다." >&2
  exit 1
fi

echo "거래처 진입점 배포와 기존 공개 share 불변 hash readback 완료"
echo "Rules/Auth/Firestore/capability에는 변경이 없습니다."
