// 회사 공용공간 API — 게시 알림(예약 포함) · 필독 미확인자 다시 알림 · 외부 공유 링크 내려받기
import { admin } from '../lib.mjs';

const isAdmin = (p) => ['system_admin', 'company_admin'].includes(p?.role);

async function recipients(post) {
  let q = admin.from('profiles').select('id, company_id').eq('active', true);
  const { data } = await q;
  const t = post.target_companies || [];
  return (data || []).filter((p) => p.id !== post.author_id && (!t.length || t.includes(p.company_id)));
}

/** 게시 시각이 된 글을 대상자에게 알림 (한 번만) */
export async function notifyDue(onlyId) {
  let q = admin.from('posts').select('*').eq('notified', false).lte('publish_at', new Date().toISOString());
  if (onlyId) q = q.eq('id', onlyId);
  const { data: posts } = await q;
  for (const p of posts || []) {
    // 먼저 표시해 두어 두 번 보내지 않게
    const { data: claimed } = await admin.from('posts').update({ notified: true }).eq('id', p.id).eq('notified', false).select('id');
    if (!claimed?.length) continue;
    const to = await recipients(p);
    const title = `${p.must_read ? '[필독] ' : ''}${p.kind === 'notice' ? '공지' : '전달'} · ${p.title}`.slice(0, 200);
    const rows = to.map((u) => ({ user_id: u.id, title, body: (p.body || '').slice(0, 140), link: `/space/board/${p.id}` }));
    for (let i = 0; i < rows.length; i += 500) await admin.from('notifications').insert(rows.slice(i, i + 500));
  }
}

export function startSpaceWorker() {
  setInterval(() => notifyDue().catch((e) => console.error('게시 알림 오류', e.message)), 60 * 1000);
}

export const spaceRoutes = {
  // 글을 올린 직후 바로 알림 (예약 글은 시각이 되면 자동)
  'POST /api/space/publish': async (me, b) => {
    const { data: p } = await admin.from('posts').select('author_id').eq('id', b.post_id).single();
    if (!p) throw [404, '글이 없습니다'];
    if (p.author_id !== me.id && !isAdmin(me)) throw [403, '권한이 없습니다'];
    await notifyDue(b.post_id);
    return { ok: true };
  },

  // 필독 글을 아직 확인하지 않은 사람에게 다시 알림
  'POST /api/space/remind': async (me, b) => {
    const { data: p } = await admin.from('posts').select('*').eq('id', b.post_id).single();
    if (!p) throw [404, '글이 없습니다'];
    if (p.author_id !== me.id && !isAdmin(me)) throw [403, '작성자나 관리자만 보낼 수 있습니다'];
    const to = await recipients(p);
    const { data: reads } = await admin.from('post_reads').select('user_id, confirmed_at').eq('post_id', p.id);
    const done = new Set((reads || []).filter((r) => (p.must_read ? r.confirmed_at : true)).map((r) => r.user_id));
    const left = to.filter((u) => !done.has(u.id));
    if (left.length) await admin.from('notifications').insert(left.map((u) => ({ user_id: u.id, title: `[다시 알림] ${p.title}`.slice(0, 200), body: p.must_read ? '필독 글입니다. 읽고 \'확인했습니다\'를 눌러 주세요.' : '', link: `/space/board/${p.id}` })));
    await admin.from('activity_log').insert({ user_id: me.id, action: '필독 다시 알림', target: `${p.title} · ${left.length}명` });
    return { sent: left.length };
  },
};

/** 외부 공유 링크: 로그인 없이 내려받기 (기한 · 횟수 확인) */
export async function shareDownload(req, res, token) {
  const fail = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>공유 링크</title><body style="font-family:sans-serif;padding:40px;color:#1A2233"><h2>${msg}</h2><p>자료를 보낸 담당자에게 새 링크를 요청해 주세요.</p></body>`); };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return fail(404, '없는 링크입니다');
  const { data: s } = await admin.from('share_links').select('*, library_files(*)').eq('token', token).maybeSingle();
  if (!s || s.revoked) return fail(404, '없거나 취소된 링크입니다');
  if (new Date(s.expires_at) < new Date()) return fail(410, '기한이 지난 링크입니다');
  if (s.max_downloads && s.downloads >= s.max_downloads) return fail(410, '이미 내려받은 링크입니다 (1회용)');
  const f = s.library_files;
  if (!f || f.visibility !== 'external') return fail(403, '외부 공유가 허용되지 않은 자료입니다');
  const { data: claimed } = await admin.from('share_links').update({ downloads: s.downloads + 1 }).eq('id', s.id).eq('downloads', s.downloads).select('id');
  if (!claimed?.length) return fail(409, '잠시 후 다시 시도해 주세요');
  const { data, error } = await admin.storage.from('space-files').download(f.path);
  if (error || !data) return fail(404, '파일을 찾을 수 없습니다');
  const buf = Buffer.from(await data.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': f.mime || 'application/octet-stream', 'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`, 'Cache-Control': 'no-store',
  });
  res.end(buf);
}
