#!/usr/bin/env bash
# DB 마이그레이션 적용 (아직 안 들어간 파일만 순서대로)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
DB="${SUPABASE_DB_CONTAINER:-supabase-db}"
PSQL=(docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q)

"${PSQL[@]}" -c "create schema if not exists gm_meta; create table if not exists gm_meta.migrations (name text primary key, applied_at timestamptz default now());"
for f in supabase/migrations/*.sql; do
  n=$(basename "$f")
  done=$("${PSQL[@]}" -tAc "select 1 from gm_meta.migrations where name='$n'")
  if [ "$done" = "1" ]; then echo "  · $n (이미 적용)"; continue; fi
  echo "  → $n 적용 중"
  { echo "begin;"; cat "$f"; echo "insert into gm_meta.migrations(name) values ('$n'); commit;"; } | "${PSQL[@]}"
done
# PostgREST가 새 테이블을 바로 알도록
"${PSQL[@]}" -c "notify pgrst, 'reload schema';"
echo "마이그레이션 완료"
