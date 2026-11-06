#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# GM 통합관리 · 홈 서버 처음 설치 (한 번만)
#   사용: cd ~/gmroad && bash scripts/setup.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
ok() { echo -e "\033[32m✓\033[0m $*"; }
step() { echo -e "\n\033[1m▶ $*\033[0m"; }
die() { echo -e "\033[31m✗ $*\033[0m"; exit 1; }

command -v docker >/dev/null || die "도커가 없습니다"
SUPA_DIR="${SUPABASE_DIR:-$HOME/supabase/docker}"
[ -f "$SUPA_DIR/.env" ] || die "수파베이스 설정($SUPA_DIR/.env)을 찾을 수 없습니다. SUPABASE_DIR=경로 bash scripts/setup.sh 로 알려주세요"
get() { grep -E "^$1=" "$SUPA_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"'; }

step "1/5 설정 파일(.env) 만들기"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s#^SUPABASE_ANON_KEY=.*#SUPABASE_ANON_KEY=$(get ANON_KEY)#" .env
  sed -i "s#^SUPABASE_SERVICE_ROLE_KEY=.*#SUPABASE_SERVICE_ROLE_KEY=$(get SERVICE_ROLE_KEY)#" .env
  sed -i "s#^SUPABASE_DIR=.*#SUPABASE_DIR=$SUPA_DIR#" .env
  ok ".env 생성 (수파베이스 키 자동 입력)"
else ok ".env 이미 있음 — 그대로 사용"; fi
set -a; . ./.env; set +a
[ -n "$SUPABASE_ANON_KEY" ] || die ".env의 SUPABASE_ANON_KEY가 비었습니다"

step "2/5 수파베이스 API에 gm 스키마 열기"
CUR=$(get PGRST_DB_SCHEMAS)
if echo ",$CUR," | grep -q ",gm,"; then ok "이미 열려 있음 ($CUR)"; else
  cp "$SUPA_DIR/.env" "$SUPA_DIR/.env.bak.$(date +%Y%m%d%H%M%S)"
  sed -i "s#^PGRST_DB_SCHEMAS=.*#PGRST_DB_SCHEMAS=${CUR},gm#" "$SUPA_DIR/.env"
  (cd "$SUPA_DIR" && docker compose up -d rest >/dev/null)
  ok "PGRST_DB_SCHEMAS=${CUR},gm (원본은 .env.bak.* 로 백업) · rest 재시작"
fi

step "3/5 DB 마이그레이션"
bash scripts/migrate.sh

step "4/5 웹앱 · API 빌드하고 띄우기 (처음엔 몇 분 걸림)"
docker compose up -d --build
ok "실행 중: $(docker compose ps --format '{{.Service}}={{.State}}' | tr '\n' ' ')"

step "5/5 기본 관리자 계정"
sleep 2
docker compose run --rm api node bootstrap.mjs

IP=$(hostname -I | awk '{print $1}')
echo -e "\n\033[1m설치 완료\033[0m"
echo "  집 안에서:     http://$IP:${WEB_PORT:-8080}"
if command -v tailscale >/dev/null; then
  TS=$(tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//')
  echo "  밖에서(HTTPS): sudo tailscale serve --bg ${WEB_PORT:-8080}  →  https://$TS"
  echo "                 (폰 카메라 · 위치 · 앱 설치는 HTTPS 주소에서 동작합니다)"
fi
