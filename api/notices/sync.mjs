// 워크니움 공지 받아 오기 — 라이선스 서버(WORKNIUM)에서 10분마다 가져와 gm.vendor_notices에 맞춰 둠
//   라이선스 서버에서 지운 공지는 여기서도 지움. 서버에 연결이 안 되면 있던 공지는 그대로 둠
import { admin } from '../lib.mjs';

const URL_ = (process.env.LICENSE_URL || '').replace(/\/+$/, '');
const KEY = process.env.LICENSE_KEY || '';
let lastErr = '';

export async function syncNotices() {
  if (!URL_ || !KEY) return { ok: false, error: '라이선스 서버 설정 없음' };
  try {
    const { data: cos } = await admin.from('companies').select('name').order('sort');
    const r = await fetch(URL_ + '/lic/v1/notices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ key: KEY, companies: (cos || []).map((c) => c.name) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '라이선스 서버 응답 ' + r.status);
    const rows = (Array.isArray(j.notices) ? j.notices : []).filter((n) => n && n.id && n.title).map((n) => ({
      id: String(n.id).slice(0, 40), title: String(n.title).slice(0, 120), body: String(n.body || '').slice(0, 5000), important: !!n.important,
      starts_at: n.starts_at || null, ends_at: n.ends_at || null,
      target_companies: Array.isArray(n.target_companies) ? n.target_companies.map(String) : [],
      target_roles: Array.isArray(n.target_roles) ? n.target_roles.filter((x) => ['system_admin', 'company_admin', 'staff', 'field', 'viewer'].includes(x)) : [],
      posted_at: n.posted_at || new Date().toISOString(), received_at: new Date().toISOString(),
    }));
    if (rows.length) { const { error } = await admin.from('vendor_notices').upsert(rows, { onConflict: 'id' }); if (error) throw new Error(error.message); }
    const { data: have, error: e2 } = await admin.from('vendor_notices').select('id');
    if (e2) throw new Error(e2.message);
    const keep = new Set(rows.map((x) => x.id));
    const gone = (have || []).map((x) => x.id).filter((id) => !keep.has(id));
    if (gone.length) await admin.from('vendor_notices').delete().in('id', gone);
    lastErr = '';
    return { ok: true, count: rows.length };
  } catch (e) {
    const m = String(e.message || e);
    if (m !== lastErr) console.error('워크니움 공지 받기 실패:', m);
    lastErr = m;
    return { ok: false, error: m };
  }
}

export function startNoticeWorker() {
  setTimeout(syncNotices, 12000);
  setInterval(syncNotices, 10 * 60e3);
}
