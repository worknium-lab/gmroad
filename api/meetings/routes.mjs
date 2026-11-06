// ⑩ 회의록 API — 처리(받아쓰기 · 요약) 시작, 확정 · 잠금 해제, 할 일 → 현장 자료요청
import { admin } from '../lib.mjs';
import { enqueue, queueInfo } from './process.mjs';
import { aiEnabled, sttHealth } from './ai.mjs';
import { scryptSync, timingSafeEqual } from 'node:crypto';

async function project(id) {
  const { data: p } = await admin.from('projects').select('id, company_id, name').eq('id', id).single();
  if (!p) throw [404, '프로젝트가 없습니다'];
  return p;
}
async function membership(me, projectId) {
  const { data } = await admin.from('project_members').select('*').eq('project_id', projectId).eq('user_id', me.id).maybeSingle();
  return data;
}
// 본사 편집 권한 (확정 · 잠금 해제 · 요청 보내기)
async function canEdit(me, projectId) {
  const p = await project(projectId);
  if (me.role === 'system_admin' || (me.role === 'company_admin' && me.company_id === p.company_id)) return p;
  if (me.role === 'staff' && (await membership(me, projectId))) return p;
  throw [403, '이 프로젝트의 편집 권한이 없습니다'];
}
// 회의록 쓰기 (현장 담당자 포함)
async function canWrite(me, projectId) {
  const p = await project(projectId);
  if (me.role === 'system_admin' || (me.role === 'company_admin' && me.company_id === p.company_id)) return p;
  const mm = await membership(me, projectId);
  if (mm && (me.role === 'staff' || (me.role === 'field' && mm.can_field))) return p;
  throw [403, '이 프로젝트의 회의록을 쓸 권한이 없습니다'];
}
async function meeting(id) {
  const { data: m } = await admin.from('meetings').select('*').eq('id', id).single();
  if (!m) throw [404, '회의록이 없습니다'];
  return m;
}
const log = (m, me, action, reason = null) => admin.from('activity_log').insert({ project_id: m.project_id, user_id: me.id, action, target: m.title, reason });
function checkPw(pw, h) {
  const [, salt, key] = String(h).split('$');
  if (!salt || !key) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(key, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const meetingRoutes = {
  'GET /api/meetings/status': async () => {
    const stt = await sttHealth();
    return { ai: aiEnabled(), stt: !!stt, stt_model: stt?.model || null, queue: queueInfo() };
  },

  // 받아쓰기 · 글자 인식 · 요약 시작 (다시 하기 포함)
  'POST /api/meetings/process': async (me, b) => {
    const m = await meeting(b.meeting_id);
    await canWrite(me, m.project_id);
    if (m.locked) throw [400, '확정된 회의록입니다. 잠금을 푼 뒤 다시 정리하세요'];
    if (!m.audio_path && !(m.pages || []).length && !(m.note_text || '').trim()) throw [400, '녹음 · 수기 · 메모 중 하나는 있어야 정리할 수 있습니다'];
    if (m.audio_path && !m.consent) throw [400, '참석자에게 녹음 사실을 알렸는지 먼저 체크해 주세요'];
    await admin.from('meetings').update({ status: 'processing', progress: '차례를 기다리는 중', error: null }).eq('id', m.id);
    const r = enqueue({ meeting_id: m.id, retranscribe: !!b.retranscribe, ocr: !!b.ocr, skipSummary: !!b.skip_summary });
    return { ok: true, ...r, ai: aiEnabled() };
  },

  // 확정: 잠그고, 결정사항 · 기한 있는 할 일 · 미결을 프로젝트 알림칸에 올리고, 참여자에게 알림
  'POST /api/meetings/confirm': async (me, b) => {
    const m = await meeting(b.meeting_id);
    await canEdit(me, m.project_id);
    if (m.locked) throw [400, '이미 확정되었습니다'];
    if (m.status === 'processing') throw [400, '아직 정리하는 중입니다'];
    const now = new Date().toISOString();
    await admin.from('meetings').update({ locked: true, status: 'reviewed', confirmed_by: me.id, confirmed_at: now, updated_at: now }).eq('id', m.id);
    await admin.from('project_alerts').delete().eq('meeting_id', m.id).eq('auto', true).eq('closed', false);
    if (m.alerts_on) {
      const s = m.summary || {};
      const { data: todos } = await admin.from('meeting_todos').select('*').eq('meeting_id', m.id).eq('done', false);
      const rows = [
        ...(s.decisions || []).map((t) => ({ kind: 'decision', text: t })),
        ...(todos || []).filter((t) => t.due_date).map((t) => ({ kind: 'todo', text: t.text, due_date: t.due_date, todo_id: t.id })),
        ...(s.open_issues || []).map((t) => ({ kind: 'open', text: t })),
      ].slice(0, 30).map((x) => ({ ...x, project_id: m.project_id, meeting_id: m.id, auto: true, created_by: me.id }));
      if (rows.length) await admin.from('project_alerts').insert(rows);
    }
    const { data: mem } = await admin.from('project_members').select('user_id').eq('project_id', m.project_id);
    const notes = (mem || []).filter((x) => x.user_id !== me.id).map((x) => ({ user_id: x.user_id, project_id: m.project_id, title: '회의록이 공유되었습니다', body: `${m.title} · ${m.summary?.one_line || ''}`.slice(0, 300), link: `/projects/${m.project_id}/meeting?m=${m.id}` }));
    if (notes.length) await admin.from('notifications').insert(notes);
    await log(m, me, '회의록 확정');
    return { ok: true };
  },

  'POST /api/meetings/unlock': async (me, b) => {
    const m = await meeting(b.meeting_id);
    const p = await canEdit(me, m.project_id);
    if (!m.locked) throw [400, '잠겨 있지 않습니다'];
    const reason = String(b.reason || '').trim();
    if (!reason) throw [400, '잠금을 푸는 사유를 적어 주세요'];
    const { data: sec } = await admin.from('boq_secrets').select('*').eq('company_id', p.company_id).maybeSingle();
    if (!sec) throw [400, '잠금 해제 비밀번호가 아직 없습니다. 관리자가 ④ 내역서 › 잠금 비밀번호에서 먼저 정해 주세요'];
    if (!checkPw(String(b.password || ''), sec.unlock_hash)) { await log(m, me, '회의록 잠금 해제 실패 (비밀번호 틀림)', reason); throw [403, '비밀번호가 맞지 않습니다']; }
    await admin.from('meetings').update({ locked: false, status: (m.summary?.one_line ? 'summarized' : 'transcribed'), updated_at: new Date().toISOString() }).eq('id', m.id);
    await log(m, me, '회의록 잠금 해제', reason);
    return { ok: true };
  },

  // 할 일을 현장 '본사 자료요청'으로 보내기
  'POST /api/meetings/todo-request': async (me, b) => {
    const { data: t } = await admin.from('meeting_todos').select('*').eq('id', b.todo_id).single();
    if (!t) throw [404, '할 일이 없습니다'];
    const m = await meeting(t.meeting_id);
    await canEdit(me, m.project_id);
    const to = b.to_user || t.assignee_id;
    if (!to) throw [400, '받을 사람을 고르세요'];
    if (!(await admin.from('project_members').select('user_id').eq('project_id', m.project_id).eq('user_id', to).maybeSingle()).data) throw [400, '프로젝트 참여자에게만 보낼 수 있습니다'];
    const { data: rq, error } = await admin.from('requests').insert({
      project_id: m.project_id, kind: b.kind || '기타', title: t.text.slice(0, 200), body: `회의록 '${m.title}'에서 보낸 할 일`,
      due_at: t.due_date ? new Date(t.due_date + 'T18:00:00+09:00').toISOString() : null, from_user: me.id, to_user: to,
    }).select().single();
    if (error) throw [400, error.message];
    await admin.from('meeting_todos').update({ request_id: rq.id, assignee_id: t.assignee_id || to }).eq('id', t.id);
    return { request_id: rq.id };
  },
};
