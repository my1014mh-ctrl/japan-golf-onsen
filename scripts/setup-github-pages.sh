#!/usr/bin/env bash
# GitHub 저장소 생성 + docs/ 를 GitHub Pages로 공개한다.
# 사전조건: gh auth login 이 완료되어 있어야 한다.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

REPO_NAME="${REPO_NAME:-japan-golf-onsen}"
VISIBILITY="${REPO_VISIBILITY:-public}"   # public | private (private는 Pages 유료 플랜 필요)

if ! gh auth status >/dev/null 2>&1; then
  echo "먼저 'gh auth login' 을 실행해 GitHub 로그인을 완료하세요." >&2
  exit 1
fi

OWNER="$(gh api user --jq .login)"
echo "계정: $OWNER / 저장소: $REPO_NAME ($VISIBILITY)"

if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "저장소가 이미 있습니다 — remote 연결만 진행합니다."
  git remote get-url origin >/dev/null 2>&1 || \
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  git push -u origin main
else
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push \
    --description "인천발 일본 골프·온천 여행 플래너 — 오전 도착 가능 공항 + 2인 플레이 골프장"
fi

echo "GitHub Pages 활성화..."
gh api "repos/$OWNER/$REPO_NAME/pages" --method POST \
     -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null 2>&1 \
  || gh api "repos/$OWNER/$REPO_NAME/pages" --method PUT \
     -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null

URL="https://$OWNER.github.io/$REPO_NAME/"
echo ""
echo "완료 — 1~2분 후 아래 주소에서 열립니다:"
echo "  $URL"
echo ""
echo "이후 'bash scripts/run-weekly.sh' 가 돌면 자동으로 push되어 페이지가 갱신됩니다."
