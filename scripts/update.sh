#!/usr/bin/env bash
# 새 버전 받기: 코드 받기 → DB 마이그레이션 → 다시 빌드
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
bash scripts/migrate.sh
docker compose up -d --build
docker image prune -f >/dev/null
echo "업데이트 완료: $(git log -1 --format='%h %s')"
