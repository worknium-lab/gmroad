// 개발용 기본값. 도커로 띄우면 컨테이너 시작 때 .env 값으로 이 파일을 새로 만듭니다.
window.__GM_CONFIG__ = {
  SUPABASE_URL: location.origin + '/sb',
  SUPABASE_ANON_KEY: '',
  API_URL: '/api'
};
