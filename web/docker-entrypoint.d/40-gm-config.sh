#!/bin/sh
# 컨테이너가 시작될 때 .env 값으로 /config.js 를 만듭니다 (서버를 옮겨도 다시 빌드할 필요 없음)
if [ -n "$GM_PUBLIC_SUPABASE_URL" ]; then SB="'$GM_PUBLIC_SUPABASE_URL'"; else SB="location.origin + '/sb'"; fi
cat > /usr/share/nginx/html/config.js <<CFG
window.__GM_CONFIG__ = {
  SUPABASE_URL: $SB,
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}',
  API_URL: '/api'
};
CFG
echo "[gm] config.js 생성 (SUPABASE_URL: $SB)"
