// 피드 안의 회의록 카드: 요약 · 결정 · 할 일 · 녹음 재생 · 전체 받아쓰기 · 수기 원본 · 확정
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, q, sb } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { dt } from '../../../lib/format';
import { useSigned, useToast, Pill, Modal } from '../../../lib/ui';
import { METHOD, MSTATUS, Meeting, Seg, mmss, patchMeeting, startProcess } from '../../../lib/meeting';

type Todo = { id: string; meeting_id: string; project_id: string; text: string; assignee_id?: string | null; assignee_name?: string | null; due_date?: string | null; done: boolean; request_id?: string | null; source: string };

export default function MeetingCard({ m, members, todos, onChange, focus }: { m: Meeting; members: any[]; todos: Todo[]; onChange: () => void; focus?: boolean }) {
  const toast = useToast();
  const { profile, canEdit } = useAuth();
  const [open, setOpen] = useState(!!focus);
  const [showTrans, setShowTrans] = useState(false);
  const [edit, setEdit] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const [page, setPage] = useState<number | null>(null);
  const [reqFor, setReqFor] = useState<Todo | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const ref = useRef<HTMLElement>(null);
  const urls = useSigned([m.audio_path, ...(m.pages || []).map((p) => p.path)]);
  const s = m.summary || {};
  const mine = m.created_by === profile?.id;
  const editable = !m.locked && (canEdit || mine);
  const busy = m.status === 'processing';
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [focus]);

  const play = (t?: number | null) => { const a = audio.current; if (!a || t == null) return; a.currentTime = Math.max(0, t - 0.5); a.play().catch(() => {}); setOpen(true); };
  const run = async (opt: any = {}) => { try { await startProcess(m.id, opt); toast('정리를 시작했습니다. 끝나면 이 카드가 바뀝니다'); onChange(); } catch (e: any) { toast(e.message); } };
  const confirmIt = async () => {
    if (!window.confirm('확정하면 잠기고, 결정사항 · 할 일이 프로젝트 알림칸에 올라가며 참여자에게 알림이 갑니다. 확정할까요?')) return;
    try { await api('/api/meetings/confirm', { meeting_id: m.id }); toast('확정했습니다'); onChange(); } catch (e: any) { toast(e.message); }
  };
  const del = async () => {
    if (!window.confirm(`'${m.title}' 회의록을 지울까요? 녹음 · 사진도 함께 지워집니다.`)) return;
    try {
      const paths = [m.audio_path, ...(m.pages || []).flatMap((p) => [p.path, p.strokes_path])].filter(Boolean) as string[];
      if (paths.length) await sb.storage.from('project-files').remove(paths);
      await q(sb.from('meetings').delete().eq('id', m.id)); onChange();
    } catch (e: any) { toast(e.message); }
  };
  const todo = async (t: Todo, x: Partial<Todo>) => { try { await q(sb.from('meeting_todos').update(x).eq('id', t.id)); onChange(); } catch (e: any) { toast(e.message); } };
  const addTodo = async () => {
    const text = prompt('할 일'); if (!text?.trim()) return;
    try { await q(sb.from('meeting_todos').insert({ meeting_id: m.id, project_id: m.project_id, text: text.trim(), sort: todos.length })); onChange(); } catch (e: any) { toast(e.message); }
  };
  const nameOf = (t: Todo) => members.find((x) => x.id === t.assignee_id)?.name || t.assignee_name || '';
  const left = todos.filter((t) => !t.done).length;

  return (
    <article ref={ref} className={'mcard' + (m.locked ? ' locked' : '')} aria-label={'회의록 ' + m.title}>
      <div className="card-h">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            <Pill c="navy">회의록</Pill>{(m.methods || []).map((k) => METHOD[k] && <Pill key={k} c={METHOD[k][1]}>{METHOD[k][0]}</Pill>)}
            <Pill c={MSTATUS[m.status]?.[1]}>{m.locked ? '🔒 ' : ''}{MSTATUS[m.status]?.[0] || m.status}</Pill>
          </div>
          <h3 style={{ fontSize: 17 }}>{m.title}</h3>
          <span className="muted">{dt(m.held_at)} · {m.kind}{m.place ? ' · ' + m.place : ''} · 참석 {m.attendees?.length || 0}명{m.audio_seconds ? ' · ' + mmss(m.audio_seconds) : ''} · {m.profiles?.name || m.profiles?.username || ''}</span>
        </div>
        <div className="row no-print">
          {editable && !busy && m.status !== 'draft' && <button className="btn sm" onClick={() => setEdit(true)}>요약 고치기</button>}
          {canEdit && !m.locked && !busy && ['summarized', 'transcribed'].includes(m.status) && <button className="btn pri sm" onClick={confirmIt}>검토 완료 · 확정</button>}
          {canEdit && m.locked && <button className="btn sm" onClick={() => setUnlock(true)}>잠금 해제</button>}
          <button className="btn sm" onClick={() => printMeeting(m, todos, members)}>인쇄</button>
        </div>
      </div>

      {busy && <div className="banner"><span>⏳ {m.progress || '정리하는 중'} — 다른 일을 하셔도 됩니다. 끝나면 알아서 바뀝니다.</span></div>}
      {m.status === 'error' && <div className="banner red"><span>정리하다 멈췄습니다: {m.error}</span>{editable && <button className="btn sm" onClick={() => run()}>다시 정리</button>}</div>}
      {m.status === 'draft' && editable && (m.audio_path || m.pages?.length || m.note_text) && !busy && <div className="banner blue"><span>아직 정리하지 않았습니다.</span><button className="btn sm pri" onClick={() => run()}>받아쓰기 · 요약 시작</button></div>}
      {m.status === 'transcribed' && !s.one_line && <div className="muted">받아쓰기는 끝났습니다. 요약은 서버에 Claude API 키가 있어야 자동으로 만들어집니다. '요약 고치기'로 직접 적을 수도 있습니다.</div>}

      {s.one_line && <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{s.one_line}</p>}
      {!!s.decisions?.length && <div><b style={{ color: 'var(--blue)' }}>결정사항</b><ul>{s.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}
      {!!s.open_issues?.length && <div><b style={{ color: 'var(--red-s)' }}>미결</b><ul>{s.open_issues.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}

      {(todos.length > 0 || editable) && <div>
        <div className="row between"><b>할 일 {todos.length ? `${todos.length - left}/${todos.length}` : ''}</b>{editable && <button className="btn sm no-print" onClick={addTodo}>+ 할 일</button>}</div>
        {todos.map((t) => (
          <div key={t.id} className={'todo' + (t.done ? ' done' : '')}>
            <input type="checkbox" checked={t.done} onChange={(e) => todo(t, { done: e.target.checked })} aria-label={t.text + ' 완료'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tx">{t.text}{t.source === 'ai' && <span className="muted"> · 자동</span>}</div>
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                {editable ? <>
                  <select className="input" style={{ height: 34, width: 140 }} value={t.assignee_id || (t.assignee_name ? '__name' : '')} onChange={(e) => todo(t, e.target.value === '__name' ? {} : { assignee_id: e.target.value || null, assignee_name: null })} aria-label="담당자">
                    <option value="">담당자 없음</option>{t.assignee_name && <option value="__name">{t.assignee_name}</option>}{members.map((p) => <option key={p.id} value={p.id}>{p.name || p.username}</option>)}</select>
                  <input type="date" className="input" style={{ height: 34, width: 150 }} value={t.due_date || ''} onChange={(e) => todo(t, { due_date: e.target.value || null })} aria-label="기한" />
                  <button className="btn sm" onClick={() => { if (confirm('이 할 일을 지울까요?')) q(sb.from('meeting_todos').delete().eq('id', t.id)).then(onChange, (e) => toast(e.message)); }}>지우기</button>
                </> : <span className="muted">{nameOf(t) || '담당자 없음'}{t.due_date ? ' · ' + t.due_date : ''}</span>}
                {canEdit && !t.done && !t.request_id && <button className="btn sm" onClick={() => setReqFor(t)}>현장에 요청</button>}
                {t.request_id && <Pill c="teal">현장 요청 보냄</Pill>}
              </div>
            </div>
          </div>))}
      </div>}

      {m.audio_path && urls[m.audio_path] && <audio ref={audio} controls preload="metadata" src={urls[m.audio_path]} style={{ width: '100%' }} />}

      <button className="btn sm no-print" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '접기 ▲' : '자세히 (안건 · 받아쓰기 · 원본) ▼'}</button>
      {open && <>
        {!!s.agenda?.length && <div><b>안건별 논의</b>
          {s.agenda.map((a, i) => <div key={i} style={{ marginTop: 6 }}>
            <div className="row"><b>{i + 1}. {a.title}</b>{a.start != null && m.audio_path && <button className="ts" onClick={() => play(a.start)}>▶ {mmss(a.start)}부터 듣기</button>}</div>
            <ul>{(a.points || []).map((p, k) => <li key={k}>{p}</li>)}</ul></div>)}
        </div>}
        {m.agenda && <div className="muted">미리 정한 안건: {m.agenda}</div>}
        {m.note_text && <div><b>메모</b><div style={{ whiteSpace: 'pre-wrap' }}>{m.note_text}</div></div>}
        {!!m.pages?.length && <div><b>{m.pages.some((p) => p.kind === 'note') ? '노트 · 수기 원본' : '수기 원본'}</b>
          <div className="thumbs">{m.pages.map((p, i) => urls[p.path] && <img key={i} src={urls[p.path]} alt={`${i + 1}쪽`} onClick={() => setPage(i)} />)}</div></div>}
        {!!m.transcript?.length && <div>
          <button className="btn sm" onClick={() => setShowTrans(!showTrans)}>{showTrans ? '받아쓰기 접기' : `전체 받아쓰기 펼치기 (${m.transcript.length}문장)`}</button>
          {showTrans && <Transcript m={m} editable={editable} audio={audio} onPlay={play} onSaved={onChange} />}
        </div>}
        {editable && !busy && <div className="row no-print">
          {m.audio_path && <button className="btn sm" onClick={() => run({ retranscribe: true })}>다시 받아쓰기</button>}
          {!!m.pages?.length && <button className="btn sm" onClick={() => run({ ocr: true })}>글자 다시 인식</button>}
          {m.status !== 'draft' && <button className="btn sm" onClick={() => run()}>요약 다시 만들기</button>}
          {!m.locked && <button className="btn sm" onClick={del}>지우기</button>}
        </div>}
      </>}

      {edit && <SummaryEditor m={m} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChange(); }} />}
      {unlock && <MeetingUnlock m={m} onClose={() => setUnlock(false)} onDone={() => { setUnlock(false); onChange(); }} />}
      {page != null && <PageView m={m} i={page} url={urls[m.pages[page].path]} editable={editable} onPlay={play} hasAudio={!!m.audio_path} onClose={() => setPage(null)} onSaved={onChange} />}
      {reqFor && <RequestModal t={reqFor} members={members} onClose={() => setReqFor(null)} onDone={() => { setReqFor(null); onChange(); toast('현장 앱 자료요청으로 보냈습니다'); }} />}
    </article>
  );
}

/* ---------- 전체 받아쓰기 ---------- */
function Transcript({ m, editable, audio, onPlay, onSaved }: { m: Meeting; editable: boolean; audio: React.RefObject<HTMLAudioElement>; onPlay: (t: number) => void; onSaved: () => void }) {
  const toast = useToast();
  const [segs, setSegs] = useState<Seg[]>(m.transcript);
  const [find, setFind] = useState('');
  const [cur, setCur] = useState(-1);
  const [dirty, setDirty] = useState(false);
  const names = useMemo(() => [...new Set([...(m.attendees || []).map((a) => a.name), ...segs.map((x) => x.speaker).filter(Boolean) as string[]])], [m.attendees, segs]);
  useEffect(() => {
    const a = audio.current; if (!a) return;
    const f = () => setCur(segs.findIndex((x) => a.currentTime >= x.start && a.currentTime < x.end + 0.3));
    a.addEventListener('timeupdate', f); return () => a.removeEventListener('timeupdate', f);
  }, [audio, segs]);
  const setSeg = (i: number, x: Partial<Seg>) => { setSegs(segs.map((s, k) => (k === i ? { ...s, ...x } : s))); setDirty(true); };
  // 말한 사람을 정하면, 바로 아래 이름 없는 줄들도 같은 사람으로
  const setSpeaker = (i: number, who: string) => {
    const n = [...segs]; n[i] = { ...n[i], speaker: who || null };
    for (let k = i + 1; k < n.length && !n[k].speaker && who; k++) n[k] = { ...n[k], speaker: who };
    setSegs(n); setDirty(true);
  };
  const save = async () => { try { await patchMeeting(m.id, { transcript: segs }); setDirty(false); toast('받아쓰기를 고쳤습니다 (원본 녹음은 그대로)'); onSaved(); } catch (e: any) { toast(e.message); } };
  const shown = segs.map((s, i) => [s, i] as const).filter(([s]) => !find || (s.text + (s.speaker || '')).includes(find));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <div className="row">
        <input className="input" style={{ width: 200, height: 36 }} placeholder="단어 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="받아쓰기에서 찾기" />
        {editable && dirty && <button className="btn pri sm" onClick={save}>고친 내용 저장</button>}
        <span className="muted">시간을 누르면 그 부분부터 들립니다.{editable ? ' 말한 사람을 고르면 아래 이름 없는 줄도 같이 채워집니다.' : ''}</span>
      </div>
      <div className="trans">
        {shown.map(([s, i]) => (
          <div key={i} className={'seg' + (i === cur ? ' now' : '')}>
            <button className="ts" onClick={() => onPlay(s.start)}>{mmss(s.start)}</button>
            <span className="who">{editable
              ? <select className="input" style={{ height: 30, fontSize: 12 }} value={s.speaker || ''} onChange={(e) => setSpeaker(i, e.target.value)} aria-label="말한 사람">
                  <option value="">말한 사람</option>{names.map((n) => <option key={n}>{n}</option>)}</select>
              : <b style={{ fontSize: 12 }}>{s.speaker || ''}</b>}</span>
            {editable ? <textarea className="input" rows={1} style={{ minHeight: 30, resize: 'vertical', padding: '4px 8px' }} value={s.text} onChange={(e) => setSeg(i, { text: e.target.value })} aria-label="문장" />
              : <span>{s.text}</span>}
          </div>))}
      </div>
    </div>
  );
}

/* ---------- 요약 고치기 ---------- */
function SummaryEditor({ m, onClose, onSaved }: { m: Meeting; onClose: () => void; onSaved: () => void }) {
  const s = m.summary || {};
  const [one, setOne] = useState(s.one_line || '');
  const [dec, setDec] = useState((s.decisions || []).join('\n'));
  const [opn, setOpn] = useState((s.open_issues || []).join('\n'));
  const [ag, setAg] = useState((s.agenda || []).map((a) => ({ ...a, pts: (a.points || []).join('\n') })));
  const [err, setErr] = useState('');
  const lines = (x: string) => x.split('\n').map((v) => v.replace(/^[-•·\s]+/, '').trim()).filter(Boolean);
  const save = async () => {
    try {
      await patchMeeting(m.id, { summary: { one_line: one.trim(), decisions: lines(dec), open_issues: lines(opn), agenda: ag.filter((a) => a.title.trim()).map((a) => ({ title: a.title.trim(), points: lines(a.pts), start: a.start ?? null })) },
        status: m.status === 'draft' || m.status === 'transcribed' ? 'summarized' : m.status });
      onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="요약 고치기" onClose={onClose} wide foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" onClick={save}>저장</button></>}>
      <div className="field"><label htmlFor="se1">한 줄 요약</label><input id="se1" className="input" value={one} onChange={(e) => setOne(e.target.value)} /></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="se2">결정사항 (한 줄에 하나)</label><textarea id="se2" className="input" rows={6} value={dec} onChange={(e) => setDec(e.target.value)} /></div>
        <div className="field"><label htmlFor="se3">미결 사항 (한 줄에 하나)</label><textarea id="se3" className="input" rows={6} value={opn} onChange={(e) => setOpn(e.target.value)} /></div>
      </div>
      <b>안건별 논의</b>
      {ag.map((a, i) => (
        <div key={i} className="grid" style={{ gridTemplateColumns: '1fr 2fr auto', gap: 8 }}>
          <input className="input" value={a.title} onChange={(e) => setAg(ag.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} aria-label="안건" placeholder="안건" />
          <textarea className="input" rows={2} value={a.pts} onChange={(e) => setAg(ag.map((x, k) => (k === i ? { ...x, pts: e.target.value } : x)))} aria-label="논의 요점" placeholder="요점 (한 줄에 하나)" />
          <button className="btn sm" onClick={() => setAg(ag.filter((_, k) => k !== i))}>빼기</button>
        </div>))}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAg([...ag, { title: '', points: [], pts: '', start: null }])}>+ 안건</button>
      <div className="muted">할 일은 카드에서 바로 고치거나 더하세요.</div>
      {err && <div className="banner red"><span>{err}</span></div>}
    </Modal>
  );
}

/* ---------- 수기 · 노트 원본 보기 (글자 고치기, 노트는 획을 누르면 그때 발언 재생) ---------- */
function PageView({ m, i, url, editable, hasAudio, onPlay, onClose, onSaved }: { m: Meeting; i: number; url?: string; editable: boolean; hasAudio: boolean; onPlay: (t: number) => void; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const p = m.pages[i];
  const [text, setText] = useState(p.text || '');
  const [strokes, setStrokes] = useState<any[] | null>(null);
  const sUrl = useSigned([p.strokes_path]);
  useEffect(() => { const u = p.strokes_path && sUrl[p.strokes_path]; if (u) fetch(u).then((r) => r.json()).then((j) => setStrokes(j.strokes || [])).catch(() => {}); }, [sUrl, p.strokes_path]);
  const save = async () => {
    try { await patchMeeting(m.id, { pages: m.pages.map((x, k) => (k === i ? { ...x, text, manual: true, unsure: [] } : x)) }); toast('저장했습니다'); onSaved(); } catch (e: any) { toast(e.message); }
  };
  const tap = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!strokes?.length || !hasAudio) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let best: any = null, bd = 0.03;
    for (const s of strokes) if (s.t != null) for (const pt of s.p) { const d = Math.hypot(pt[0] - x, pt[1] - y); if (d < bd) { bd = d; best = s; } }
    if (best) { onPlay(best.t / 1000); toast(`${mmss(best.t / 1000)} 발언을 재생합니다`); }
  };
  return (
    <Modal title={`${p.kind === 'note' ? '노트' : '수기'} ${i + 1}쪽`} onClose={onClose} wide foot={editable ? <><button className="btn" onClick={onClose}>닫기</button><button className="btn pri" onClick={save}>글자 저장</button></> : undefined}>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>{url && <img src={url} alt={`${i + 1}쪽 원본`} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, cursor: strokes?.length && hasAudio ? 'pointer' : 'default' }} onClick={tap} />}
          {p.kind === 'note' && hasAudio && <div className="muted">필기를 누르면 그 글씨를 쓰던 때의 발언이 재생됩니다.</div>}</div>
        <div className="field"><label htmlFor="pv1">옮긴 글자 {p.unsure?.length ? <Pill c="orange">확인 필요 {p.unsure.length}줄</Pill> : null}</label>
          <textarea id="pv1" className="input" rows={18} value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} placeholder={editable ? '글자 인식 전입니다. 직접 적어도 됩니다' : ''} />
          {!!p.unsure?.length && <div className="muted">확인 필요: {p.unsure.join(' / ')}</div>}
        </div>
      </div>
    </Modal>
  );
}

function MeetingUnlock({ m, onClose, onDone }: { m: Meeting; onClose: () => void; onDone: () => void }) {
  const [pw, setPw] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  const go = async () => { try { await api('/api/meetings/unlock', { meeting_id: m.id, password: pw, reason }); onDone(); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal title={`잠금 해제 · ${m.title}`} onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!pw || !reason.trim()} onClick={go}>잠금 풀기</button></>}>
      <p className="sub">내역서와 같은 회사 잠금 해제 비밀번호입니다. 누가 · 언제 · 왜 풀었는지 기록됩니다.</p>
      <div className="field"><label htmlFor="mu1">비밀번호</label><input id="mu1" className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></div>
      <div className="field"><label htmlFor="mu2">사유</label><input id="mu2" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 감리단 요청으로 결정사항 문구 수정" /></div>
      {err && <div className="banner red"><span>{err}</span></div>}
    </Modal>
  );
}

function RequestModal({ t, members, onClose, onDone }: { t: Todo; members: any[]; onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState(t.assignee_id || '');
  const [kind, setKind] = useState('기타');
  const [err, setErr] = useState('');
  const go = async () => { try { await api('/api/meetings/todo-request', { todo_id: t.id, to_user: to, kind }); onDone(); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal title="현장에 요청 보내기" onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!to} onClick={go}>보내기</button></>}>
      <p className="sub">'{t.text}'을(를) 현장 앱 '도면 · 알림'의 본사 자료요청으로 보냅니다. 받는 사람에게 알림이 갑니다.</p>
      <div className="field"><label htmlFor="rq1">받는 사람</label><select id="rq1" className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">고르세요</option>{members.map((p) => <option key={p.id} value={p.id}>{p.name || p.username}{p.role === 'field' ? ' (현장)' : ''}</option>)}</select></div>
      <div className="field"><label htmlFor="rq2">요청 종류</label><select id="rq2" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{['사진', '송장·계산서', '수량 확인', '서류', '기타'].map((k) => <option key={k}>{k}</option>)}</select></div>
      {err && <div className="banner red"><span>{err}</span></div>}
    </Modal>
  );
}

/* ---------- 인쇄 (회의록 양식) ---------- */
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function printMeeting(m: Meeting, todos: Todo[], members: any[]) {
  const s = m.summary || {};
  const who = (t: Todo) => members.find((x) => x.id === t.assignee_id)?.name || t.assignee_name || '';
  const li = (a?: string[]) => (a?.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>-</p>');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>
  body{font-family:'Noto Sans KR',sans-serif;margin:24px;color:#111;font-size:13px} h1{text-align:center;font-size:22px;letter-spacing:8px;margin:0 0 16px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px} th,td{border:1px solid #333;padding:6px 8px;vertical-align:top;text-align:left} th{background:#F2F4F7;width:90px;white-space:nowrap}
  h2{font-size:14px;margin:14px 0 6px} ul{margin:0;padding-left:18px} .sign td{height:42px}</style></head><body>
  <h1>회 의 록</h1>
  <table><tr><th>회의명</th><td colspan="3">${esc(m.title)}</td></tr>
  <tr><th>일시</th><td>${esc(new Date(m.held_at).toLocaleString('ko-KR'))}</td><th>장소</th><td>${esc(m.place || '')}</td></tr>
  <tr><th>구분</th><td>${esc(m.kind)}</td><th>상태</th><td>${m.locked ? '확정 ' + esc(m.confirmed_at ? new Date(m.confirmed_at).toLocaleDateString('ko-KR') : '') : '검토 전'}</td></tr>
  <tr><th>참석자</th><td colspan="3">${(m.attendees || []).map((a) => esc(a.name + (a.org ? `(${a.org})` : ''))).join(', ')}</td></tr>
  <tr><th>요약</th><td colspan="3">${esc(s.one_line || '')}</td></tr></table>
  <h2>안건별 논의</h2>${(s.agenda || []).map((a, i) => `<b>${i + 1}. ${esc(a.title)}</b>${li(a.points)}`).join('') || '<p>-</p>'}
  <h2>결정사항</h2>${li(s.decisions)}<h2>미결 사항</h2>${li(s.open_issues)}
  <h2>할 일</h2><table><tr><th style="width:auto">내용</th><th>담당</th><th>기한</th><th>완료</th></tr>${todos.map((t) => `<tr><td>${esc(t.text)}</td><td>${esc(who(t))}</td><td>${esc(t.due_date || '')}</td><td>${t.done ? '✔' : ''}</td></tr>`).join('') || '<tr><td colspan="4">-</td></tr>'}</table>
  <h2>참석자 확인</h2><table class="sign"><tr>${(m.attendees || []).slice(0, 6).map((a) => `<th>${esc(a.name)}</th><td style="width:80px"></td>`).join('')}</tr></table>
  <script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank'); if (!w) return alert('팝업이 막혀 있습니다. 이 사이트의 팝업을 허용해 주세요');
  w.document.write(html); w.document.close();
}
