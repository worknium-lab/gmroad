// GM 통합관리 · 관리 API
// service_role 키가 필요한 작업(계정 생성, 비밀번호 초기화)만 여기서 합니다.
// 나머지 데이터는 웹앱이 수파베이스에 직접 접근하고, 권한은 DB의 RLS가 지킵니다.
import http from 'node:http';
import { admin, idToEmail, tempPassword } from './lib.mjs';

const PORT = Number(process.env.PORT || 3001);
const PROFILE_FIELDS = ['name', 'company_id', 'role', 'emp_no', 'dept', 'rank', 'position', 'phone', 'email', 'address', 'hire_date', 'active'];

async function caller(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: p } = await admin.from('profiles').select('*').eq('id', data.user.id).single();
  return p && p.active ? p : null;
}
const isAdmin = (p) => p && ['system_admin', 'company_admin'].includes(p.role);

async function body(req) {
  let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('too large'); }
  return s ? JSON.parse(s) : {};
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

const routes = {
  'GET /api/health': async () => ({ ok: true, time: new Date().toISOString() }),

  'POST /api/admin/users': async (me, b) => {
    if (!isAdmin(me)) throw [403, '관리자만 계정을 만들 수 있습니다'];
    const username = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw [400, '아이디는 영문 · 숫자 3자 이상'];
    if (me.role === 'company_admin') {
      if (b.role === 'system_admin') throw [403, '회사 관리자는 시스템 관리자를 만들 수 없습니다'];
      if (b.company_id && b.company_id !== me.company_id) throw [403, '자기 회사 계정만 만들 수 있습니다'];
      b.company_id = me.company_id;
    }
    const password = tempPassword();
    const { data, error } = await admin.auth.admin.createUser({ email: idToEmail(username), password, email_confirm: true, user_metadata: { username } });
    if (error) throw [400, error.message.includes('already') ? '이미 있는 아이디입니다' : error.message];
    const row = { id: data.user.id, username, must_change_password: true };
    for (const k of PROFILE_FIELDS) if (b[k] !== undefined && b[k] !== '') row[k] = b[k];
    const { error: e2 } = await admin.from('profiles').insert(row);
    if (e2) { await admin.auth.admin.deleteUser(data.user.id); throw [400, e2.message]; }
    await admin.from('activity_log').insert({ user_id: me.id, action: '계정 생성', target: username });
    return { id: data.user.id, temp_password: password };
  },

  'POST /api/admin/users/reset': async (me, b) => {
    if (!isAdmin(me)) throw [403, '관리자만 할 수 있습니다'];
    const { data: t } = await admin.from('profiles').select('*').eq('id', b.id).single();
    if (!t) throw [404, '계정이 없습니다'];
    if (me.role === 'company_admin' && (t.company_id !== me.company_id || t.role === 'system_admin')) throw [403, '권한이 없습니다'];
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(t.id, { password });
    if (error) throw [400, error.message];
    await admin.from('profiles').update({ must_change_password: true }).eq('id', t.id);
    await admin.from('activity_log').insert({ user_id: me.id, action: '비밀번호 초기화', target: t.username });
    return { temp_password: password };
  },
};

http.createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0].replace(/\/+$/, '');
  const fn = routes[`${req.method} ${path}`];
  if (!fn) return send(res, 404, { error: 'not found' });
  try {
    const me = path === '/api/health' ? null : await caller(req);
    if (path !== '/api/health' && !me) return send(res, 401, { error: '로그인이 필요합니다' });
    send(res, 200, await fn(me, req.method === 'POST' ? await body(req) : {}));
  } catch (e) {
    if (Array.isArray(e)) return send(res, e[0], { error: e[1] });
    console.error(e); send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`GM API listening on :${PORT}`));
