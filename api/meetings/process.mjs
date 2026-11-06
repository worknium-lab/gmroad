// 회의록 처리 순서: 녹음 받아쓰기 → 수기 · 노트 글자 인식 → 요약 · 할 일
// 한 번에 하나씩 (작은 서버에서 받아쓰기가 CPU를 많이 씀)
import { admin } from '../lib.mjs';
import { aiEnabled, transcribe, summarize, readPage } from './ai.mjs';

const BUCKET = 'project-files';
const queue = [];
let running = null;

export function enqueue(job) {
  const i = queue.findIndex((x) => x.meeting_id === job.meeting_id);
  if (i >= 0) queue[i] = { ...queue[i], ...job };
  else if (running?.meeting_id !== job.meeting_id) queue.push(job);
  setImmediate(work);
  return { position: queue.findIndex((x) => x.meeting_id === job.meeting_id) + 1 };
}
export const queueInfo = () => ({ running: running?.meeting_id || null, waiting: queue.map((x) => x.meeting_id) });

async function work() {
  if (running || !queue.length) return;
  running = queue.shift();
  try { await run(running); } catch (e) { console.error('회의록 처리 오류', e); }
  running = null;
  setImmediate(work);
}

const set = (id, x) => admin.from('meetings').update({ ...x, updated_at: new Date().toISOString() }).eq('id', id);
async function download(path) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error('파일을 받을 수 없습니다: ' + (error?.message || path));
  return Buffer.from(await data.arrayBuffer());
}

/** 받아쓰기 · 요약을 돕는 현장 용어 (공법 · 공종 · 자재 · 참석자 이름) */
export async function glossaryOf(projectId, m) {
  const [{ data: p }, { data: wi }, { data: mt }] = await Promise.all([
    admin.from('projects').select('name, client, patent_method').eq('id', projectId).single(),
    admin.from('work_items').select('name').eq('project_id', projectId),
    admin.from('materials').select('name, spec').eq('project_id', projectId),
  ]);
  const words = [p?.patent_method, p?.client, ...(wi || []).map((x) => x.name), ...(mt || []).map((x) => x.name), ...(m?.attendees || []).map((a) => a.name)];
  return [...new Set(words.filter(Boolean).flatMap((w) => String(w).split(/[,/·]/)).map((w) => w.trim()).filter((w) => w.length > 1))];
}

async function members(projectId) {
  const { data } = await admin.from('project_members').select('user_id, profiles:user_id(id, name, username)').eq('project_id', projectId);
  return (data || []).map((x) => x.profiles).filter(Boolean);
}

export async function run(job) {
  const { data: m } = await admin.from('meetings').select('*').eq('id', job.meeting_id).single();
  if (!m) return;
  try {
    const gl = await glossaryOf(m.project_id, m);
    let transcript = m.transcript || [];
    let audioSeconds = m.audio_seconds;
    // 1) 받아쓰기
    if (m.audio_path && (!transcript.length || job.retranscribe)) {
      await set(m.id, { status: 'processing', progress: '녹음 받아쓰는 중 (1시간 녹음이면 서버에 따라 10~40분)', error: null });
      const r = await transcribe(await download(m.audio_path), gl.slice(0, 60).join(', '));
      transcript = (r.segments || []).map((s) => ({ start: s.start, end: s.end, speaker: null, text: s.text }));
      audioSeconds = Math.round(r.duration || 0);
      await set(m.id, { transcript, audio_seconds: audioSeconds });
    }
    // 2) 수기 · 노트 글자 인식
    let pages = m.pages || [];
    const need = pages.map((p, i) => [p, i]).filter(([p]) => p.path && (job.ocr || !p.text) && !p.manual);
    if (need.length && aiEnabled()) {
      for (const [p, i] of need) {
        await set(m.id, { status: 'processing', progress: `글자 인식 중 (${i + 1}/${pages.length}쪽)`, error: null });
        const buf = await download(p.path);
        const type = /\.png$/i.test(p.path) ? 'image/png' : /\.webp$/i.test(p.path) ? 'image/webp' : 'image/jpeg';
        const r = await readPage(buf, type, gl);
        pages = pages.map((x, k) => (k === i ? { ...x, text: r.text || '', unsure: r.unsure || [] } : x));
        await set(m.id, { pages });
      }
    }
    // 3) 요약 · 할 일
    const hasText = transcript.length || pages.some((p) => p.text) || (m.note_text || '').trim();
    if (!aiEnabled() || !hasText || job.skipSummary) {
      await set(m.id, { status: hasText ? 'transcribed' : 'draft', progress: null, error: !aiEnabled() && hasText ? null : m.error });
      return;
    }
    await set(m.id, { status: 'processing', progress: '요약 · 할 일 정리 중', error: null });
    const people = await members(m.project_id);
    const s = await summarize({ ...m, transcript, pages }, { members: people.map((x) => x.name || x.username), glossary: gl });
    const summary = { one_line: s.one_line || '', agenda: s.agenda || [], decisions: s.decisions || [], open_issues: s.open_issues || [] };
    // 요약에서 뽑은 할 일은 새로 바꾸고, 사람이 넣은 할 일은 그대로
    await admin.from('meeting_todos').delete().eq('meeting_id', m.id).eq('source', 'ai').eq('done', false);
    const byName = (n) => people.find((x) => n && (x.name === n || x.username === n || (x.name && n.includes(x.name))));
    const todos = (s.todos || []).filter((t) => t?.text).slice(0, 50).map((t, k) => {
      const who = byName(t.assignee);
      return { meeting_id: m.id, project_id: m.project_id, text: String(t.text).slice(0, 500), assignee_id: who?.id || null, assignee_name: who ? null : (t.assignee || null),
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : null, source: 'ai', sort: k };
    });
    if (todos.length) await admin.from('meeting_todos').insert(todos);
    await set(m.id, { summary, status: 'summarized', progress: null, error: null });
  } catch (e) {
    await set(m.id, { status: 'error', progress: null, error: String(e.message || e).slice(0, 500) });
  }
}

/** 서버가 다시 켜질 때 처리 중이던 회의록 이어서 */
export async function resume() {
  const { data } = await admin.from('meetings').select('id').eq('status', 'processing');
  for (const m of data || []) enqueue({ meeting_id: m.id });
}
