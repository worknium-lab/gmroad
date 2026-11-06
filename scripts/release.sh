#!/usr/bin/env bash
# 고객사 배포판 만들기 (WORKNIUM 전용 — 대표님 PC/서버에서 실행)
#   소스코드는 주지 않고, 알아보기 어렵게 섞은(난독화) 완성 프로그램만 이미지로 만듭니다.
#   라이선스 서버의 공개키를 프로그램 안에 박고, 파일 지문 목록을 라이선스 서버에 등록합니다.
#   → 고객 서버에서 파일을 한 글자라도 고치면 다음 확인 때 '위변조'로 잡혀 읽기 전용이 됩니다.
#
# 사용: LICENSE_URL=https://라이선스서버 LICENSE_ADMIN_PASSWORD=… bash scripts/release.sh 2026.11.07 [레지스트리]
#   레지스트리 예: ghcr.io/worknium-lab  (비공개 저장소, 미리 docker login)
set -euo pipefail
cd "$(dirname "$0")/.."
VER="${1:?버전을 넣으세요 (예: 2026.11.07)}"; REG="${2:-}"
: "${LICENSE_URL:?LICENSE_URL (라이선스 서버 주소)}"; : "${LICENSE_ADMIN_PASSWORD:?LICENSE_ADMIN_PASSWORD (라이선스 관리 비밀번호)}"
[[ "$VER" =~ ^[0-9A-Za-z._-]{1,40}$ ]] || { echo "버전은 영문 · 숫자 · . _ - 만"; exit 1; }
OUT="$(mktemp -d)/gm-$VER"; mkdir -p "$OUT"
step() { echo; echo "■ $*"; }
OBF="npx --yes javascript-obfuscator@4"

step "1/6 라이선스 서버 공개키 받기"
PUB=$(curl -fsS "$LICENSE_URL/lic/v1/pubkey" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).pubkey))")
[ ${#PUB} -ge 40 ] || { echo "공개키를 받지 못했습니다"; exit 1; }
echo "  공개키 $PUB"

step "2/6 웹 빌드 + 난독화"
cp -r web "$OUT/web"; rm -rf "$OUT/web/node_modules" "$OUT/web/dist"
( cd "$OUT/web" && npm ci --silent && npm run build --silent )
$OBF "$OUT/web/dist/assets" --output "$OUT/web/dist/assets" --target browser --compact true \
  --string-array true --string-array-encoding base64 --identifier-names-generator hexadecimal --rename-globals false >/dev/null
WEBFILES=$(node -e "import('$PWD/api/license/manifest.mjs').then(m=>console.log(JSON.stringify(m.listWebDist('$OUT/web/dist'))))")

step "3/6 API 복사 + 공개키 · 버전 박기 + 난독화"
mkdir -p "$OUT/api"; tar -C api --exclude=node_modules -cf - . | tar -C "$OUT/api" -xf -
cat > "$OUT/api/license/pubkey.mjs" <<JS
export const PUBKEY = '$PUB';
export const VERSION = '$VER';
export const WEB_FILES = $WEBFILES;
JS
# 라이선스 부분은 더 강하게 (제어 흐름 섞기), 나머지는 이름 · 문자열 섞기
find "$OUT/api" -path "$OUT/api/node_modules" -prune -o \( -name '*.mjs' -o -name '*.cjs' \) -print | while read -r f; do
  extra=""; case "$f" in */license/*) extra="--control-flow-flattening true --dead-code-injection true";; esac
  $OBF "$f" --output "$f" --target node --compact true --string-array true --string-array-encoding base64 \
    --identifier-names-generator hexadecimal --rename-globals false $extra >/dev/null
done
( cd "$OUT/api" && npm ci --omit=dev --silent && node -e "import('./license/token.mjs').then(()=>console.log('  API 모듈 확인 OK'))" ) 

step "4/6 파일 지문 목록 만들기"
node -e "
const m=await import('$PWD/api/license/manifest.mjs');const fs=await import('node:fs');
const files={...m.hashDir('$OUT/api')};
for(const f of m.listWebDist('$OUT/web/dist')) files['web/'+f]=m.sha(fs.readFileSync('$OUT/web/dist/'+f));
fs.writeFileSync('$OUT/manifest.json',JSON.stringify({version:'$VER',files},null,1));console.log('  파일',Object.keys(files).length,'개');" --input-type=module

step "5/6 라이선스 서버에 배포판 등록"
TOK=$(curl -fsS -H 'Content-Type: application/json' -d "{\"password\":\"$LICENSE_ADMIN_PASSWORD\"}" "$LICENSE_URL/admin/api/login" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
curl -fsS -H 'Content-Type: application/json' -H "Authorization: Bearer $TOK" -d @"$OUT/manifest.json" "$LICENSE_URL/admin/api/manifest" >/dev/null && echo "  등록 완료 ($VER)"

# 고객 서버 설치 꾸러미 (DB 구조 · 설치 설정만, 프로그램 소스 없음)
mkdir -p "$OUT/install/supabase" "$OUT/install/scripts"
cp -r supabase/migrations "$OUT/install/supabase/"; cp scripts/migrate.sh scripts/backup.sh "$OUT/install/scripts/"
cp docker-compose.customer.yml "$OUT/install/docker-compose.yml"; cp .env.example "$OUT/install/.env.example"
printf 'GM_VERSION=%s\nGM_REGISTRY=%s\n' "$VER" "$REG" >> "$OUT/install/.env.example"
tar -C "$OUT" -czf "$OUT/gm-install-$VER.tgz" install && echo "  설치 꾸러미: $OUT/gm-install-$VER.tgz"
[ -n "${NO_IMAGE:-}" ] && { echo "NO_IMAGE — 이미지는 만들지 않음. 작업 폴더: $OUT"; exit 0; }

step "6/6 이미지 만들기"
cp web/Dockerfile.release "$OUT/web/Dockerfile.release"
rm -rf "$OUT/api/node_modules"
docker build -q -t "${REG:+$REG/}gm-api:$VER" "$OUT/api"
docker build -q -t "${REG:+$REG/}gm-web:$VER" -f "$OUT/web/Dockerfile.release" "$OUT/web"
if [ -n "$REG" ]; then docker push -q "$REG/gm-api:$VER"; docker push -q "$REG/gm-web:$VER"; echo "  올림: $REG/gm-api:$VER, $REG/gm-web:$VER"; fi
echo; echo "완료: 배포판 $VER  (고객 서버: GM_VERSION=$VER 으로 docker compose -f docker-compose.customer.yml up -d)"
echo "작업 폴더: $OUT (소스 없음 — 확인 후 지워도 됩니다)"
