#!/usr/bin/env bash
# 생성된 페이지를 외부 호스팅으로 배포한다.
#   PUBLISH_TARGET=github  → git commit + push (GitHub Pages가 docs/ 를 서빙)
#   PUBLISH_TARGET=surge   → npx surge docs/ $SURGE_DOMAIN
# 설정은 .env 또는 환경변수로 넘긴다.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# .env 로드
if [ -f .env ]; then set -a; . ./.env; set +a; fi

TARGET="${PUBLISH_TARGET:-none}"

case "$TARGET" in
  github)
    if [ ! -d .git ]; then echo "git 저장소가 아닙니다. git init 후 remote를 설정하세요." >&2; exit 1; fi
    if ! git remote get-url origin >/dev/null 2>&1; then echo "origin remote가 없습니다." >&2; exit 1; fi
    if git diff --quiet HEAD -- docs/ 2>/dev/null; then
      echo "docs/ 변경 없음 — 배포 생략"
      exit 0
    fi
    git add docs/ out/history/ 2>/dev/null || git add docs/
    git commit -q -m "chore: $(date +%Y-%m-%d) 주간 갱신

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
    git push -q origin HEAD
    echo "GitHub에 푸시 완료 — Pages가 1~2분 내 반영합니다"
    ;;
  surge)
    : "${SURGE_DOMAIN:?SURGE_DOMAIN 을 설정하세요 (예: japan-golf-onsen.surge.sh)}"
    cp docs/index.html docs/200.html   # surge SPA 폴백
    npx --yes surge ./docs "$SURGE_DOMAIN"
    echo "배포 완료 — https://$SURGE_DOMAIN"
    ;;
  none)
    echo "PUBLISH_TARGET 이 설정되지 않아 배포를 건너뜁니다."
    ;;
  *)
    echo "알 수 없는 PUBLISH_TARGET: $TARGET" >&2; exit 1
    ;;
esac
