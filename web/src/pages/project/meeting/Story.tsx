// ⑩ 회의록 · 스토리: 회의록 · 현장 기록 · 서류가 시간순으로 이어지는 피드 + 남은 할 일
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, q, sb } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { dt, DOC, qty as fq } from '../../../lib/format';
import { useLoad, Loading, ErrorBox, Pill } from '../../../lib/ui';
import { Meeting } from '../../../lib/meeting';
import MeetingCard from './MeetingCard';
import MeetingStart, { Way } from './MeetingStart';
import NotePad from './NotePad';

type Item = { at: string; kind: 'meeting' | 'site' | 'doc'; key: string; m?: Meeting; icon?: string; ic?: string; title?: string; body?: string; link?: string };
const dayOf = (s: string) => { const d = new Date(s); const W = ['일', '월', '화', '수', '목', '금', '토']; return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${W[d.getDay()]})`; };

export default function Story({ pid }: { pid: string }) {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [filter, setFilter] = useState<'all' | 'meeting' | 'site' | 'doc'>('all');
  const [start, setStart] = useState<Way | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [st, setSt] = useState<any>(null);
  const data = useLoad(async () => {
    const [meetings, todos, mem, reports, moves, docs, reqs, boq] = await Promise.all([
      q<Meeting[]>(sb.from('meetings').select('*, profiles:created_by(name, username)').eq('project_id', pid).order('held_at', { ascending: false }).limit(200)),
      q<any[]>(sb.from('meeting_todos').select('*').eq('project_id', pid).order('sort')),
      q<any[]>(sb.from('project_members').select('profiles:user_id(id, name, username, role)').eq('project_id', pid)),
      q<any[]>(sb.from('daily_reports').select('id, report_date, status, work_note, submitted_at, confirmed_at').eq('project_id', pid).neq('status', 'draft').order('report_date', { ascending: false }).limit(120)),
      q<any[]>(sb.from('material_moves').select('id, move_date, kind, qty, vendor, created_at, materials(name, spec, unit)').eq('project_id', pid).eq('kind', 'in').order('created_at', { ascending: false }).limit(120)),
      q<any[]>(sb.from('documents').select('id, category, subcategory, title, version, created_at').eq('project_id', pid).order('created_at', { ascending: false }).limit(120)),
      q<any[]>(sb.from('requests').select('id, title, kind, status, created_at, answered_at').eq('project_id', pid).order('created_at', { ascending: false }).limit(120)),
      sb.from('boq_logs').select('id, action, revision_title, created_at').eq('project_id', pid).in('action', ['확정', '도급내역서 생성', '준공내역서 생성', '변경내역서 만들기', '잠금 해제']).order('created_at', { ascending: false }).limit(60).then((r) => r.data || []),
    ]);
    return { meetings, todos, members: mem.map((x) => x.profiles).filter(Boolean), reports, moves, docs, reqs, boq };
  }, [pid]);
  const reload = data.reload;
  useEffect(() => { api('/api/meetings/status').then(setSt).catch(() => setSt(null)); }, []);
  // 정리 중인 회의록이 있으면 실시간 + 10초마다 새로
  const anyBusy = (data.data?.meetings || []).some((m) => m.status === 'processing');
  useEffect(() => {
    const ch = sb.channel('mt-' + pid).on('postgres_changes', { event: '*', schema: 'gm', table: 'meetings', filter: `project_id=eq.${pid}` }, () => reload()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [pid]);
  useEffect(() => { if (!anyBusy) return; const t = setInterval(reload, 10000); return () => clearInterval(t); }, [anyBusy]);

  const noteId = sp.get('note');
  useEffect(() => { if (noteId && data.data && !data.data.meetings.some((m) => m.id === noteId)) reload(); }, [noteId, data.data]);
  const focusId = sp.get('m');
  const d = data.data;
  const items = useMemo<Item[]>(() => {
    if (!d) return [];
    const out: Item[] = [];
    for (const m of d.meetings) out.push({ at: m.held_at, kind: 'meeting', key: 'm' + m.id, m });
    for (const r of d.reports) out.push({ at: r.submitted_at || r.report_date + 'T18:00:00', kind: 'site', key: 'r' + r.id, icon: '📋', ic: 'teal', title: `작업일보 ${r.status === 'confirmed' ? '· 본사 확인' : r.status === 'returned' ? '· 수정 요청' : '제출'}`, body: r.work_note || '', link: `/projects/${pid}/site` });
    for (const x of d.moves) out.push({ at: x.created_at, kind: 'site', key: 'v' + x.id, icon: '🚚', ic: 'teal', title: `자재 반입 · ${x.materials?.name || ''} ${x.materials?.spec || ''}`, body: `${fq(x.qty)} ${x.materials?.unit || ''}${x.vendor ? ' · ' + x.vendor : ''}`, link: `/projects/${pid}/materials` });
    for (const x of d.reqs) out.push({ at: x.created_at, kind: 'site', key: 'q' + x.id, icon: '📨', ic: 'orange', title: `자료요청 · ${x.kind}`, body: x.title + (x.status === 'done' ? ' (완료)' : ''), link: `/projects/${pid}/site` });
    for (const x of d.docs) out.push({ at: x.created_at, kind: 'doc', key: 'd' + x.id, icon: '📄', ic: 'gray', title: `${DOC[x.category] || x.category}${x.subcategory ? ' · ' + x.subcategory : ''} 올림`, body: `${x.title} v${x.version}`, link: `/projects/${pid}/${x.category === 'construction' ? 'construction' : 'docs'}` });
    for (const x of d.boq) out.push({ at: x.created_at, kind: 'doc', key: 'b' + x.id, icon: '📊', ic: 'gray', title: `내역서 · ${x.action}`, body: x.revision_title, link: `/projects/${pid}/boq` });
    return out.filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at));
  }, [d, pid]);
  if (data.loading && !d) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('meetings') ? '회의록 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error} />;

  const shown = items.filter((x) => filter === 'all' || x.kind === filter).slice(0, limit);
  const todosOf = (mid: string) => d!.todos.filter((t) => t.meeting_id === mid);
  const openTodos = d!.todos.filter((t) => !t.done && (!mineOnly || t.assignee_id === profile?.id)).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const mtitle = (id: string) => d!.meetings.find((m) => m.id === id)?.title || '';
  const noteM = noteId ? d!.meetings.find((m) => m.id === noteId) : null;
  const today = new Date().toISOString().slice(0, 10);
  let lastDay = '';

  return (
    <div className="story">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <section className="card">
          <div className="card-h"><h2>회의 기록</h2>
            {st && <span className="muted">받아쓰기 {st.stt ? '켜짐' : '꺼짐'} · 자동 요약 {st.ai ? '켜짐' : '꺼짐 (API 키 없음)'}</span>}</div>
          <div className="row">
            <button className="btn pri" style={{ background: 'var(--red-s)', borderColor: 'var(--red-s)' }} onClick={() => setStart('rec')}>● 지금 녹음</button>
            <button className="btn" onClick={() => setStart('file')}>녹음파일 올리기</button>
            <button className="btn" onClick={() => setStart('hand')}>수기 스캔 · 사진</button>
            <button className="btn" onClick={() => setStart('note')}>태블릿 노트</button>
            <button className="btn" onClick={() => setStart('memo')}>메모</button>
          </div>
          {st && !st.stt && <div className="muted">받아쓰기 서버가 꺼져 있어 녹음은 저장만 됩니다. 서버 .env에 COMPOSE_PROFILES=stt 를 넣고 업데이트하면 켜집니다.</div>}
        </section>

        <div className="row between">
          <div className="seg" role="group" aria-label="보기">
            {([['all', '전체'], ['meeting', '회의록'], ['site', '현장'], ['doc', '서류 · 내역서']] as const).map(([k, l]) =>
              <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <span className="muted">{items.length}개 기록</span>
        </div>

        {!shown.length && <div className="empty">아직 기록이 없습니다. 위에서 회의 기록을 시작해 보세요.</div>}
        {shown.map((x) => {
          const day = dayOf(x.at); const head = day !== lastDay ? day : null; lastDay = day;
          return (
            <div key={x.key} style={{ display: 'contents' }}>
              {head && <div className="feed-day">{head}</div>}
              {x.kind === 'meeting' && x.m ? <MeetingCard m={x.m} members={d!.members} todos={todosOf(x.m.id)} onChange={reload} focus={focusId === x.m.id} />
                : <div className="feed-item">
                    <div className={'ic ' + (x.ic || '')} aria-hidden>{x.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row between"><b>{x.title}</b><span className="muted">{dt(x.at)}</span></div>
                      {x.body && <div className="sub" style={{ whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: 60 }}>{x.body}</div>}
                    </div>
                    {x.link && <button className="btn sm" onClick={() => nav(x.link!)}>열기</button>}
                  </div>}
            </div>);
        })}
        {items.filter((x) => filter === 'all' || x.kind === filter).length > limit && <button className="btn" onClick={() => setLimit(limit + 60)}>더 보기</button>}
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 12 }}>
        <section className="card">
          <div className="card-h"><h2>남은 할 일 {openTodos.length}</h2>
            <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} style={{ width: 20, height: 20 }} /> 내 것만</label></div>
          {!openTodos.length && <span className="sub">남은 할 일이 없습니다.</span>}
          {openTodos.slice(0, 30).map((t) => {
            const late = t.due_date && t.due_date < today;
            const who = d!.members.find((p: any) => p.id === t.assignee_id);
            return (
              <div key={t.id} className="todo">
                <input type="checkbox" checked={false} onChange={() => q(sb.from('meeting_todos').update({ done: true }).eq('id', t.id)).then(reload)} aria-label={t.text + ' 완료'} />
                <div style={{ minWidth: 0 }}>
                  <div>{t.text}</div>
                  <div className="muted">{who?.name || t.assignee_name || '담당자 없음'}{t.due_date ? ' · ' : ''}{t.due_date && <span style={{ color: late ? 'var(--red-s)' : undefined, fontWeight: late ? 700 : undefined }}>{t.due_date}{late ? ' 지남' : ''}</span>}</div>
                  <button className="link muted" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setSp({ m: t.meeting_id })}>{mtitle(t.meeting_id)}</button>
                </div>
              </div>);
          })}
        </section>
      </aside>

      {start && <MeetingStart pid={pid} members={d!.members} way={start} onClose={() => setStart(null)} onDone={(m) => { setStart(null); reload(); setSp({ m: m.id }); }} />}
      {noteM && <NotePad m={noteM} onClose={() => { setSp({ m: noteM.id }); reload(); }} />}
    </div>
  );
}
