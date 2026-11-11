// WORKNIUM 라이선스 서버 — 고객사 계약 · 입금 확인 · 라이선스 발급 · 위변조 감시
//   서명 개인키는 /data/keys 에만 있고 밖으로 나가지 않습니다. (이 폴더를 백업하되 절대 남에게 주지 마세요)
//   고객사 서버는 하루 1번 /lic/v1/check 로 와서 서명된 라이선스를 받아 갑니다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { issue, rawFromPub } from './token.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.LICENSE_DATA || '/data';
const PORT = Number(process.env.PORT || 3100);
fs.mkdirSync(path.join(DATA, 'keys'), { recursive: true, mode: 0o700 });

/* ---------- 키 (처음 한 번 생성, 다시 만들지 않음) ---------- */
const KEY = path.join(DATA, 'keys', 'signing.pem');
if (!fs.existsSync(KEY)) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(KEY, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  console.log('서명 키를 새로 만들었습니다:', KEY);
}
const PRIV = crypto.createPrivateKey(fs.readFileSync(KEY));
const PUB = rawFromPub(crypto.createPublicKey(PRIV));

/* ---------- 저장 (JSON 파일, 바꿀 때마다 통째로 안전하게 씀) ---------- */
const DBF = path.join(DATA, 'db.json');
const db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : {};
db.customers ||= []; db.events ||= []; db.manifests ||= {}; db.push ||= []; db.notices ||= [];
db.secret ||= crypto.randomBytes(32).toString('hex');
if (!db.vapid) { const k = webpush.generateVAPIDKeys(); db.vapid = k; }
if (!db.admin && process.env.LICENSE_ADMIN_PASSWORD) db.admin = hashPw(process.env.LICENSE_ADMIN_PASSWORD);
save();
webpush.setVapidDetails('mailto:admin@worknium.local', db.vapid.publicKey, db.vapid.privateKey);
function save() { const tmp = DBF + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 }); fs.renameSync(tmp, DBF); }
function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); }
function checkPw(pw, stored) { if (!stored) return false; const [salt, h] = stored.split(':'); const a = crypto.scryptSync(String(pw), salt, 32); return crypto.timingSafeEqual(a, Buffer.from(h, 'hex')); }

/* ---------- 날짜 (한국 시간) ---------- */
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const endOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);   // m: 0~11
export function addPaidMonths(paidUntil, months, today = kstToday()) {
  // 아직 안 끝났으면 기한 뒤로, 이미 끝났으면 지난달 말일을 기준으로 (= 이번 달부터)
  let [y, m] = (paidUntil && paidUntil >= today ? paidUntil : (() => { const [ty, tm] = today.split('-').map(Number); return endOfMonth(ty, tm - 2); })()).split('-').map(Number);
  return endOfMonth(y, m - 1 + months);
}

/* ---------- 알림 (대표님 폰) ---------- */
function event(cid, kind, text) {
  const e = { at: new Date().toISOString(), cid, kind, text, seen: false };
  db.events.unshift(e); db.events = db.events.slice(0, 2000); save();
  if (['위변조', '새 설치', '미등록 프로그램', 'DB 변조'].includes(kind)) alert(`[라이선스] ${kind}`, text);
  return e;
}
async function alert(title, body) {
  for (const s of [...db.push]) {
    try { await webpush.sendNotification(s, JSON.stringify({ title, body, url: '/' }), { TTL: 86400, urgency: 'high' }); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) { db.push = db.push.filter((x) => x.endpoint !== s.endpoint); save(); } }
  }
}

/* ---------- 라이선스 만들기 ---------- */
function payloadFor(c, iid, extra = {}) {
  return { v: 1, cid: c.id, cname: c.name, iid, paid_until: c.paid_until, readonly_extra: c.readonly_extra || 0, tampered: false, note: '', iat: new Date().toISOString(), nonce: crypto.randomBytes(8).toString('hex'), ...extra };
}

/** 고객사 서버의 하루 1번 확인 */
function check(b, ip) {
  const c = findCustomer(b.key);
  if (!c) throw [403, '등록되지 않은 고객 키입니다'];
  if (!/^[0-9a-f-]{36}$/.test(String(b.iid))) throw [400, '설치 번호가 없습니다'];
  c.installs ||= [];
  let ins = c.installs.find((x) => x.iid === b.iid);
  if (!ins) {
    ins = { iid: b.iid, first_seen: new Date().toISOString(), approved: c.installs.filter((x) => x.approved).length === 0 };
    c.installs.push(ins);
    event(c.id, '새 설치', `${c.name}: 새 서버에서 연결 (${ip})${ins.approved ? ' — 첫 설치라 자동 승인' : ' — 승인 필요 (다른 서버에서 같은 키 사용)'}`);
  }
  Object.assign(ins, { last_seen: new Date().toISOString(), ip, version: String(b.version || '').slice(0, 40) });
  const notes = [];
  let tampered = !!c.tamper_hold;
  if (c.tamper_hold) notes.push(c.tamper_note || '위변조 확인 전까지 읽기 전용');
  if (!ins.approved) { tampered = true; notes.push('승인되지 않은 설치(다른 서버)'); }
  // 프로그램 지문 비교
  const man = db.manifests[b.version];
  const hashes = b.hashes && typeof b.hashes === 'object' ? b.hashes : {};
  if (man) {
    const bad = Object.keys(man.files).filter((f) => hashes[f] !== man.files[f]);
    const extra = Object.keys(hashes).filter((f) => !(f in man.files));
    if (bad.length || extra.length) {
      tampered = true; c.tamper_hold = true; c.tamper_note = `프로그램 파일 변조 감지 (${bad.length + extra.length}개)`;
      notes.push(c.tamper_note);
      event(c.id, '위변조', `${c.name}: 바뀐 파일 ${[...bad, ...extra].slice(0, 5).join(', ')}${bad.length + extra.length > 5 ? ' 외' : ''}`);
    }
  } else if (!c.allow_dev) {
    tampered = true; notes.push('등록되지 않은 프로그램 버전');
    event(c.id, '미등록 프로그램', `${c.name}: 등록 안 된 버전 '${b.version}'으로 연결`);
  }
  if (b.db_mismatch) {
    tampered = true; c.tamper_hold = true; c.tamper_note = 'DB의 라이선스 값이 직접 수정됨';
    notes.push(c.tamper_note); event(c.id, 'DB 변조', `${c.name}: ${b.db_mismatch}`);
  }
  c.last_check = { at: new Date().toISOString(), ip, version: b.version, tampered };
  save();
  return { token: issue(payloadFor(c, b.iid, { tampered, note: notes.join(' · ') }), PRIV, PUB) };
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const findCustomer = (key) => db.customers.find((x) => x.key && key && crypto.timingSafeEqual(Buffer.from(sha(x.key)), Buffer.from(sha(String(key)))));

/* ---------- 고객사 공지 (로그인 팝업) ---------- */
const ROLES = ['system_admin', 'company_admin', 'staff', 'field', 'viewer'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const nextDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
/** 고객사 서버가 10분마다 가져감. 그 회사들 이름을 같이 알려 줘서 관리 화면에서 회사를 고를 수 있게 함 */
function noticesFor(b) {
  const c = findCustomer(b.key);
  if (!c) throw [403, '등록되지 않은 고객 키입니다'];
  const names = Array.isArray(b.companies) ? b.companies.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 50) : [];
  if (names.length && JSON.stringify(names) !== JSON.stringify(c.companies || [])) { c.companies = names; save(); }
  const today = kstToday();
  return {
    notices: db.notices
      .filter((n) => !n.customers?.length || n.customers.includes(c.id))
      .filter((n) => !n.end || n.end >= today)
      .map((n) => ({
        id: n.id, title: n.title, body: n.body, important: !!n.important,
        starts_at: n.start ? n.start + 'T00:00:00+09:00' : null,
        ends_at: n.end ? nextDay(n.end) + 'T00:00:00+09:00' : null,
        target_companies: n.companies || [], target_roles: n.roles || [], posted_at: n.created_at,
      })),
  };
}

/* ---------- 관리 (로그인) ---------- */
const sessions = new Map();
function login(b) {
  if (!db.admin) { if (String(b.password || '').length < 8) throw [400, '처음 쓰는 관리 비밀번호를 8자 이상 정하세요']; db.admin = hashPw(b.password); save(); }
  else if (!checkPw(b.password, db.admin)) { throw [401, '비밀번호가 틀렸습니다']; }
  const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 12 * 3600e3);
  return { token: t };
}
function authed(req) { const t = (req.headers.authorization || '').replace(/^Bearer\s+/, ''); const exp = sessions.get(t); return exp && exp > Date.now(); }
const newKey = () => 'GM-' + crypto.randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').match(/.{1,4}/g).join('-');
const cust = (id) => { const c = db.customers.find((x) => x.id === id); if (!c) throw [404, '고객사가 없습니다']; return c; };

const admin = {
  'GET /admin/api/state': () => ({
    pubkey: PUB, vapid: db.vapid.publicKey, today: kstToday(), versions: Object.keys(db.manifests).map((v) => ({ v, at: db.manifests[v].at, n: Object.keys(db.manifests[v].files).length })),
    customers: db.customers.map(({ key, ...c }) => ({ ...c, key_tail: key.slice(-4) })), events: db.events.slice(0, 200),
    notices: db.notices,
  }),
  'POST /admin/api/notice': (b) => {
    const title = String(b.title || '').trim().slice(0, 120);
    if (!title) throw [400, '공지 제목을 넣으세요'];
    if (b.start && !isDate(b.start)) throw [400, '시작일 형식'];
    if (b.end && !isDate(b.end)) throw [400, '종료일 형식'];
    if (b.start && b.end && b.end < b.start) throw [400, '종료일이 시작일보다 빠릅니다'];
    const known = new Set(db.customers.map((c) => c.id));
    const row = {
      title, body: String(b.body || '').slice(0, 5000), important: !!b.important, start: b.start || null, end: b.end || null,
      customers: (Array.isArray(b.customers) ? b.customers : []).filter((x) => known.has(x)),
      companies: (Array.isArray(b.companies) ? b.companies : []).map((x) => String(x).slice(0, 60)).filter(Boolean),
      roles: (Array.isArray(b.roles) ? b.roles : []).filter((x) => ROLES.includes(x)),
      updated_at: new Date().toISOString(),
    };
    let n = b.id && db.notices.find((x) => x.id === b.id);
    if (n) Object.assign(n, row);
    else { n = { id: 'n-' + crypto.randomBytes(6).toString('hex'), created_at: row.updated_at, ...row }; db.notices.unshift(n); }
    event(null, '공지', `${b.id ? '수정' : '보냄'}: ${title}`); save();
    return { id: n.id };
  },
  'POST /admin/api/notice-delete': (b) => {
    const n = db.notices.find((x) => x.id === b.id); if (!n) throw [404, '공지가 없습니다'];
    db.notices = db.notices.filter((x) => x.id !== b.id); event(null, '공지', `내림: ${n.title}`); save(); return { ok: true };
  },
  'POST /admin/api/customer': (b) => {
    let c = b.id && db.customers.find((x) => x.id === b.id);
    const fields = ['name', 'biz_no', 'contact', 'fee_setup', 'fee_month', 'memo', 'allow_dev'];
    if (!c) {
      if (!String(b.name || '').trim()) throw [400, '고객사 이름을 넣으세요'];
      c = { id: crypto.randomUUID(), key: newKey(), created_at: new Date().toISOString(), paid_until: b.paid_until || kstToday(), readonly_extra: 0, installs: [], payments: [] };
      db.customers.push(c); event(c.id, '등록', `${b.name} 등록`);
    }
    for (const f of fields) if (b[f] !== undefined) c[f] = b[f];
    save(); return { id: c.id, key: c.key };
  },
  'POST /admin/api/key': (b) => ({ key: cust(b.id).key }),
  'POST /admin/api/pay': (b) => {
    const c = cust(b.id); const months = Math.max(1, Math.min(24, Number(b.months) || 1));
    const before = c.paid_until; c.paid_until = addPaidMonths(c.paid_until, months);
    c.payments.push({ at: new Date().toISOString(), months, from: before, until: c.paid_until, amount: Number(b.amount) || null, memo: b.memo || '' });
    event(c.id, '입금 확인', `${c.name}: ${months}개월 · 사용 기한 ${before} → ${c.paid_until}`); save();
    return { paid_until: c.paid_until };
  },
  'POST /admin/api/set-until': (b) => {
    const c = cust(b.id); if (!/^\d{4}-\d{2}-\d{2}$/.test(b.paid_until)) throw [400, '날짜 형식'];
    event(c.id, '기한 직접 지정', `${c.name}: ${c.paid_until} → ${b.paid_until}${b.memo ? ' (' + b.memo + ')' : ''}`);
    c.paid_until = b.paid_until; save(); return { ok: true };
  },
  'POST /admin/api/extend': (b) => {
    const c = cust(b.id); const d = Math.max(0, Math.min(365, Number(b.days) || 0));
    c.readonly_extra = (c.readonly_extra || 0) + d; event(c.id, '백업 연장', `${c.name}: ${d}일 (누적 ${c.readonly_extra}일)`); save(); return { ok: true };
  },
  'POST /admin/api/install': (b) => {
    const c = cust(b.id); const i = (c.installs || []).find((x) => x.iid === b.iid); if (!i) throw [404, '설치가 없습니다'];
    if (b.remove) c.installs = c.installs.filter((x) => x.iid !== b.iid); else i.approved = !!b.approved;
    event(c.id, '설치 변경', `${c.name}: ${b.iid.slice(0, 8)} ${b.remove ? '삭제' : b.approved ? '승인' : '승인 취소'}`); save(); return { ok: true };
  },
  'POST /admin/api/clear-tamper': (b) => { const c = cust(b.id); c.tamper_hold = false; c.tamper_note = ''; event(c.id, '위변조 해제', `${c.name}: 확인 후 해제`); save(); return { ok: true }; },
  'POST /admin/api/offline': (b) => {
    const c = cust(b.id); if (!/^[0-9a-f-]{36}$/.test(String(b.iid))) throw [400, '고객 화면의 설치 번호를 넣으세요'];
    event(c.id, '오프라인 파일', `${c.name}: ${b.iid.slice(0, 8)}용 파일 발급`);
    return { token: issue(payloadFor(c, b.iid, { tampered: !!c.tamper_hold, note: c.tamper_hold ? c.tamper_note : '' }), PRIV, PUB) };
  },
  'POST /admin/api/manifest': (b) => {
    if (!/^[\w.\-]{1,40}$/.test(String(b.version)) || !b.files || typeof b.files !== 'object') throw [400, '버전 · 파일 목록'];
    db.manifests[b.version] = { at: new Date().toISOString(), files: b.files }; event(null, '배포판 등록', `${b.version} (${Object.keys(b.files).length}개 파일)`); save(); return { ok: true };
  },
  'POST /admin/api/push': (b) => { if (!b.endpoint) throw [400, '구독 정보']; db.push = db.push.filter((x) => x.endpoint !== b.endpoint); db.push.push(b); save(); return { ok: true }; },
  'POST /admin/api/push-test': async () => { await alert('[라이선스] 시험 알림', '대표님 폰으로 알림이 잘 옵니다.'); return { ok: true, devices: db.push.length }; },
  'POST /admin/api/password': (b) => { if (String(b.password || '').length < 8) throw [400, '8자 이상']; db.admin = hashPw(b.password); sessions.clear(); save(); return { ok: true }; },
};

/* ---------- HTTP ---------- */
const hits = new Map();
function limited(ip) { const now = Date.now(); const h = (hits.get(ip) || []).filter((t) => now - t < 60000); h.push(now); hits.set(ip, h); return h.length > 60; }
async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 4e6) throw [413, '너무 큽니다']; } return s ? JSON.parse(s) : {}; }
function send(res, code, obj, type = 'application/json; charset=utf-8') { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); }

export const server = http.createServer(async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const p = (req.url || '').split('?')[0];
  try {
    if (limited(ip)) throw [429, '요청이 너무 많습니다'];
    if (req.method === 'GET' && (p === '/' || p === '/admin')) return send(res, 200, fs.readFileSync(path.join(DIR, 'admin.html'), 'utf8'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/sw.js') return send(res, 200, `self.addEventListener('push',e=>{const d=e.data?e.data.json():{};e.waitUntil(self.registration.showNotification(d.title||'라이선스',{body:d.body||''}))});self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow('/'))});`, 'text/javascript');
    if (req.method === 'GET' && p === '/lic/v1/pubkey') return send(res, 200, { pubkey: PUB });
    if (req.method === 'POST' && p === '/lic/v1/check') return send(res, 200, check(await body(req), ip));
    if (req.method === 'POST' && p === '/lic/v1/notices') return send(res, 200, noticesFor(await body(req)));
    if (req.method === 'POST' && p === '/admin/api/login') { await new Promise((r) => setTimeout(r, 400)); return send(res, 200, login(await body(req))); }
    const fn = admin[`${req.method} ${p}`];
    if (!fn) throw [404, 'not found'];
    if (!authed(req)) throw [401, '로그인이 필요합니다'];
    return send(res, 200, await fn(req.method === 'POST' ? await body(req) : {}));
  } catch (e) {
    if (Array.isArray(e)) return send(res, e[0], { error: e[1] });
    console.error(e); return send(res, 500, { error: '서버 오류' });
  }
});
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) server.listen(PORT, () => console.log(`WORKNIUM 라이선스 서버 :${PORT} · 공개키 ${PUB}`));
