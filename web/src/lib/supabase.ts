import { createClient } from '@supabase/supabase-js';

type Cfg = { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; API_URL: string };
export const cfg: Cfg = (window as any).__GM_CONFIG__ || { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', API_URL: '/api' };

// gm 스키마를 기본으로 씀 (같은 수파베이스의 public 스키마는 호비스가 사용)
export const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  db: { schema: 'gm' },
  auth: { persistSession: true, autoRefreshToken: true },
});

export const BUCKET = 'project-files';
// 로그인 아이디 → 내부 이메일 (수파베이스 인증은 이메일 기반)
export const idToEmail = (id: string) => (id.includes('@') ? id : `${id.trim().toLowerCase()}@gm.local`);

/** 오류를 던지는 쿼리 도우미 */
export async function q<T = any>(p: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

/** 관리 API 호출 (계정 생성 등 service key가 필요한 작업) */
export async function api(path: string, body?: any) {
  const { data } = await sb.auth.getSession();
  const res = await fetch(cfg.API_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
