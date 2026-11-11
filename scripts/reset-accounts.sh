#!/usr/bin/env bash
# 계정 초기화: GM 통합관리 계정을 모두 지우고 기본 관리자(gmconst)만 새로 만듦
#   프로젝트 · 내역서 · 사진 등 자료는 지우지 않음. 실행 전에 자동으로 백업함
#   bash scripts/reset-accounts.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
DB="${SUPABASE_DB_CONTAINER:-supabase-db}"

echo "GM 통합관리의 모든 계정(아이디 · 비밀번호 · 인사정보)을 지우고 기본 관리자 '${ADMIN_USERNAME:-gmconst}' 하나만 새로 만듭니다."
echo "프로젝트 · 내역서 · 사진 같은 자료는 그대로 남습니다."
read -r -p "계속하려면 '초기화' 라고 입력하세요: " ans
[ "$ans" = "초기화" ] || { echo "취소했습니다."; exit 1; }

echo "1/3 백업 중…"
bash scripts/backup.sh

echo "2/3 계정 지우는 중…"
docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < scripts/reset-accounts.sql

echo "3/3 기본 관리자 만드는 중…"
docker compose run --rm api node bootstrap.mjs
