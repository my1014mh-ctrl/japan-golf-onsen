#!/usr/bin/env bash
# 매주 월요일 배치: 스케줄 갱신 → 페이지 재생성 → 변경 요약 기록
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
mkdir -p out/history logs

# .env 로드 (DATA_GO_KR_KEY, PUBLISH_TARGET 등)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

STAMP="$(date +%Y-%m-%d)"
LOG="logs/weekly-$STAMP.log"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S %Z') 주간 갱신 시작 ==="

  PREV="out/analysis.json"
  if [ -f "$PREV" ]; then cp "$PREV" "out/history/analysis-prev.json"; fi

  # 예약사이트 링크 유효성 점검 (실패해도 빌드는 계속)
  if [ "${SKIP_ENRICH:-0}" != "1" ]; then
    echo "--- 예약링크 검증 ---"
    node scripts/enrich.mjs --verify 2>&1 | tail -5 || echo "검증 생략(네트워크)"
  fi

  node src/build.mjs --source=auto

  cp out/analysis.json "out/history/analysis-$STAMP.json"

  if [ -f out/history/analysis-prev.json ]; then
    echo "--- 지난 주 대비 변경 ---"
    node scripts/diff.mjs out/history/analysis-prev.json out/analysis.json || true
  fi

  if [ "${PUBLISH_TARGET:-none}" != "none" ]; then
    echo "--- 외부 배포 ---"
    bash scripts/publish.sh || echo "배포 실패 (로컬 페이지는 정상 갱신됨)"
  fi

  echo "=== 완료 ==="
} 2>&1 | tee "$LOG"
