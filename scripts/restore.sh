#!/usr/bin/env bash
# 복원 (회사 서버로 옮길 때): bash scripts/restore.sh backups/20261106-0330
#   새 서버에 수파베이스를 먼저 띄우고 setup.sh 1~2단계까지 한 뒤 실행하세요.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?백업 폴더를 지정하세요}"
set -a; . ./.env; set +a
DB="${SUPABASE_DB_CONTAINER:-supabase-db}"
read -p "현재 서버의 gm 데이터를 $SRC 로 덮어씁니다. 계속할까요? (yes) " a; [ "$a" = "yes" ] || exit 1
docker exec -i "$DB" pg_restore -U supabase_admin -d postgres --data-only --disable-triggers < "$SRC/auth.dump" || true
docker exec -i "$DB" psql -U supabase_admin -d postgres -c "drop schema if exists gm cascade; drop schema if exists gm_meta cascade;"
docker exec -i "$DB" pg_restore -U supabase_admin -d postgres < "$SRC/gm.dump"
docker exec -i "$DB" psql -U supabase_admin -d postgres -c "insert into storage.buckets (id, name, public) values ('project-files','project-files',false) on conflict do nothing;"
docker exec -i "$DB" psql -U supabase_admin -d postgres -c "copy storage.objects from stdin with csv header" < "$SRC/storage_objects.csv" || echo "storage.objects 복원 경고 (이미 있으면 무시)"
[ -f "$SRC/files.tgz" ] && tar -xzf "$SRC/files.tgz" -C "${SUPABASE_DIR}/volumes/storage"
docker exec -i "$DB" psql -U supabase_admin -d postgres -c "notify pgrst, 'reload schema';"
echo "복원 완료"
