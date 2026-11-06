// 고객사 서버 쪽 라이선스 — 하루 1번 라이선스 서버에 확인, 서명 검증, 프로그램 지문 보고, DB 값 대조
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admin } from '../lib.mjs';
import { open } from './token.mjs';
import { hashDir, hashWeb } from './manifest.mjs';
import { PUBKEY, VERSION, WEB_FILES } from './pubkey.mjs';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = (process.env.LICENSE_URL || '').replace(/\/+$/, '');
const KEY = process.env.LICENSE_KEY || '';
const WEB = (process.env.WEB_INTERNAL_URL || 'http://web:80').replace(/\/+$/, '');

async function state() {
  const { data, error } = await admin.from('license_state').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('license_state 읽기 실패: ' + error.message);
  if (!data) {   // 누가 행을 지웠으면 차단 상태가 되므로, 새로 만들되 위변조로 표시
    const { data: d2 } = await admin.from('license_state').insert({ id: 1, paid_until: '2000-01-01', tampered: true, tamper_note: '라이선스 기록이 지워져 있었음' }).select().single();
    return d2;
  }
  return data;
}
const upd = (patch) => admin.from('license_state').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);

/** 쓸 공개키: 배포판은 프로그램에 박힌 것, 개발판은 처음 받은 것을 DB에 고정 */
async function pubkey(s) {
  if (PUBKEY) return PUBKEY;
  if (s.pubkey) return s.pubkey;
  if (!URL_) return null;
  const r = await fetch(URL_ + '/lic/v1/pubkey', { signal: AbortSignal.timeout(15000) });
  const { pubkey: k } = await r.json();
  await upd({ pubkey: k });
  return k;
}

/** 검증된 라이선스 내용을 DB에 반영 (시계는 앞으로만) */
async function apply(p, token, s) {
  if (p.iid !== s.install_id) throw new Error('다른 서버용 라이선스입니다 (설치 번호가 다름)');
  const seen = [s.max_seen_at, p.iat, new Date().toISOString()].filter(Boolean).sort().pop();
  await upd({ customer_id: p.cid, customer_name: p.cname, paid_until: p.paid_until, readonly_extra: p.readonly_extra || 0,
    tampered: !!p.tampered, tamper_note: p.note || null, token, max_seen_at: seen, last_error: null });
}

/** 지금 이 서버의 프로그램 지문 */
export async function fingerprint() {
  const api = hashDir(API_ROOT);
  const web = await hashWeb(WEB, WEB_FILES.length ? WEB_FILES : ['index.html', 'sw.js']);
  return { ...api, ...web };
}

/** DB 값이 서명된 라이선스와 같은지 (DB를 직접 고쳤는지) */
async function dbMismatch(s) {
  if (!s.token) return null;
  const k = await pubkey(s); if (!k) return null;
  let p; try { p = open(s.token, k); } catch (e) { return '저장된 라이선스 원본이 손상됨: ' + e.message; }
  const diff = [];
  if (p.paid_until !== String(s.paid_until)) diff.push(`사용 기한 ${p.paid_until} → ${s.paid_until}`);
  if ((p.readonly_extra || 0) !== s.readonly_extra) diff.push(`백업 연장 ${p.readonly_extra} → ${s.readonly_extra}`);
  if (!!p.tampered && !s.tampered) diff.push('위변조 표시를 지움');
  return diff.length ? diff.join(', ') : null;
}

let busy = false;
/** 라이선스 서버에 확인 (하루 1번 + 관리자가 [지금 확인]) */
export async function checkNow() {
  if (busy) return { ok: false, error: '이미 확인 중' };
  busy = true;
  try {
    const s = await state();
    const mism = await dbMismatch(s);
    if (mism) await upd({ tampered: true, tamper_note: 'DB의 라이선스 값이 직접 수정됨' });
    if (!URL_ || !KEY) { await upd({ last_error: '라이선스 서버 주소 · 고객 키가 설정되지 않았습니다 (.env 의 LICENSE_URL · LICENSE_KEY)', last_check_ok: false }); return { ok: false, error: '설정 없음' }; }
    const k = await pubkey(s);
    const r = await fetch(URL_ + '/lic/v1/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ key: KEY, iid: s.install_id, version: VERSION, hashes: await fingerprint(), db_mismatch: mism }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '라이선스 서버 응답 ' + r.status);
    const p = open(j.token, k);
    await apply(p, j.token, await state());
    await upd({ last_check_at: new Date().toISOString(), last_check_ok: true });
    return { ok: true, paid_until: p.paid_until, tampered: p.tampered, note: p.note };
  } catch (e) {
    await upd({ last_check_at: new Date().toISOString(), last_check_ok: false, last_error: String(e.message || e).slice(0, 300) }).catch(() => {});
    return { ok: false, error: e.message };
  } finally { busy = false; }
}

/** 인터넷이 막힌 서버: 관리자가 받은 라이선스 파일을 올림 */
export async function uploadToken(token) {
  const s = await state();
  const k = await pubkey(s);
  if (!k) throw [400, '공개키가 없습니다. 이 서버가 라이선스 서버에 한 번도 연결된 적이 없으면 WORKNIUM에 배포판을 요청하세요'];
  let p; try { p = open(String(token || '').trim(), k); } catch (e) { throw [400, e.message]; }
  if (s.token) { try { const old = open(s.token, k); if (old.iat > p.iat) throw [400, '지금 것보다 오래된 라이선스 파일입니다']; } catch (e) { if (Array.isArray(e)) throw e; } }
  try { await apply(p, String(token).trim(), s); } catch (e) { throw [400, e.message]; }
  await upd({ last_check_at: new Date().toISOString(), last_check_ok: true });
  return { paid_until: p.paid_until, tampered: p.tampered, note: p.note };
}

/** 매시간: 시계 앞으로 · DB 대조 / 하루 1번: 서버 확인 */
let mode = { v: 'normal', at: 0 };
export async function licenseMode() {
  if (Date.now() - mode.at < 60000) return mode.v;
  const { data } = await admin.rpc('license_mode');
  mode = { v: data || 'normal', at: Date.now() };
  return mode.v;
}
export function startLicenseWorker() {
  let lastDay = '';
  const hourly = async () => {
    try {
      const s = await state();
      if (new Date(s.max_seen_at) < new Date()) await upd({ max_seen_at: new Date().toISOString() });
      const mism = await dbMismatch(s);
      if (mism && !s.tampered) { await upd({ tampered: true, tamper_note: 'DB의 라이선스 값이 직접 수정됨' }); await checkNow(); }
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      if (day !== lastDay || !s.last_check_ok) { lastDay = day; await checkNow(); }
      mode.at = 0;
    } catch (e) { console.error('라이선스 확인 오류', e.message); }
  };
  setTimeout(hourly, 8000);
  setInterval(hourly, 3600e3);
}

const ADMINS = ['system_admin', 'company_admin'];
export const licenseRoutes = {
  'GET /api/license/status': async (me) => {
    const { data } = await admin.rpc('license_info');
    const s = await state();
    return { ...data, admin: ADMINS.includes(me.role), configured: !!(URL_ && KEY), version: VERSION,
      ...(ADMINS.includes(me.role) ? { last_error: s.last_error, tamper_note: s.tamper_note } : {}) };
  },
  'POST /api/license/check-now': async (me) => { if (!ADMINS.includes(me.role)) throw [403, '관리자만']; mode.at = 0; return checkNow(); },
  'POST /api/license/upload': async (me, b) => { if (!ADMINS.includes(me.role)) throw [403, '관리자만']; mode.at = 0; return uploadToken(b.token); },
};
