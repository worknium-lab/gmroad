#!/usr/bin/env bash
# 백업: gm 스키마 데이터 + 로그인 계정 + 업로드 파일 → backups/날짜/
#   매일 자동: crontab -e →  30 3 * * * cd ~/gmroad && bash scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
DB="${SUPABASE_DB_CONTAINER:-supabase-db}"
OUT="backups/$(date +%Y%m%d-%H%M)"; mkdir -p "$OUT"
docker exec "$DB" pg_dump -U supabase_admin -d postgres -n gm -n gm_meta -Fc > "$OUT/gm.dump"
docker exec "$DB" pg_dump -U supabase_admin -d postgres --data-only -t auth.users -t auth.identities -Fc > "$OUT/auth.dump"
docker exec "$DB" psql -U supabase_admin -d postgres -At -c "copy (select * from storage.objects where bucket_id='project-files') to stdout with csv header" > "$OUT/storage_objects.csv"
STORE="${SUPABASE_DIR}/volumes/storage"
[ -d "$STORE" ] && tar -czf "$OUT/files.tgz" -C "$STORE" . 2>/dev/null || echo "파일 폴더($STORE)를 찾지 못해 파일 백업은 건너뜀"
ls backups | sort | head -n -14 | while read d; do [ -d "backups/$d" ] && rm -rf "backups/$d"; done   # 최근 14개만 보관
echo "백업 완료: $OUT ($(du -sh "$OUT" | cut -f1))"
