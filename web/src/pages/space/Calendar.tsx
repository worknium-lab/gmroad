// 회사 일정: 월간 달력 (전사 · 교육 · 현장 · 마감 · 회사별), 공지의 날짜도 함께
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { q, sb } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useLoad, useToast, Loading, ErrorBox, Modal } from '../../lib/ui';
import { CATS } from '../../lib/space';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function CalendarPage() {
  const { company, companies, canEdit, profile, isAdmin } = useAuth();
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [off, setOff] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<any>(null);
  const first = new Date(cur.getFullYear(), cur.getMonth(), 1), last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()));
  const data = useLoad(() => q<any[]>(sb.from('events').select('*').lte('starts_on', ymd(end)).order('starts_on')), [ymd(start)]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('events') ? '일정 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error} />;
  const evs = (data.data || []).filter((e) => (e.ends_on || e.starts_on) >= ymd(start) && !off.has(e.category) && (company === 'all' || !e.company_id || e.company_id === company));
  const days: Date[] = []; for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const on = (d: Date) => { const s = ymd(d); return evs.filter((e) => e.starts_on <= s && (e.ends_on || e.starts_on) >= s); };
  const today = ymd(new Date());
  const coName = (id?: string) => companies.find((c) => c.id === id)?.name || '';
  const upcoming = (data.data || []).filter((e) => (e.ends_on || e.starts_on) >= today).slice(0, 8);
  return (
    <>
      <div className="row between">
        <h1>회사 일정</h1>
        <div className="row">
          <button className="btn sm" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))} aria-label="이전 달">‹</button>
          <b style={{ fontSize: 18, minWidth: 110, textAlign: 'center' }}>{cur.getFullYear()}년 {cur.getMonth() + 1}월</b>
          <button className="btn sm" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))} aria-label="다음 달">›</button>
          <button className="btn sm" onClick={() => { const d = new Date(); setCur(new Date(d.getFullYear(), d.getMonth(), 1)); }}>오늘</button>
          {canEdit && <button className="btn pri" onClick={() => setEdit({ title: '', starts_on: today, ends_on: '', category: '전사', company_id: '', time_text: '', place: '', note: '' })}>일정 추가</button>}
        </div>
      </div>
      <div className="row">{Object.entries(CATS).map(([k, c]) => (
        <label key={k} className="row" style={{ gap: 6, minHeight: 36 }}><input type="checkbox" checked={!off.has(k)} onChange={() => { const n = new Set(off); n.has(k) ? n.delete(k) : n.add(k); setOff(n); }} style={{ width: 18, height: 18, accentColor: c }} />
          <span style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />{k === '회사' ? '회사별' : k}</label>))}</div>
      <section className="card flat">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {'일월화수목금토'.split('').map((w, i) => <div key={w} style={{ padding: 8, textAlign: 'center', fontWeight: 700, fontSize: 13, background: 'var(--head)', color: i === 0 ? 'var(--red-s)' : i === 6 ? 'var(--blue)' : undefined }}>{w}</div>)}
          {days.map((d) => { const s = ymd(d); const inM = d.getMonth() === cur.getMonth(); const list = on(d); return (
            <div key={s} style={{ minHeight: 104, borderTop: '1px solid var(--line-2)', borderLeft: d.getDay() ? '1px solid var(--line-2)' : undefined, padding: 4, background: s === today ? '#FFF8E1' : inM ? '#fff' : '#FAFBFC', cursor: canEdit ? 'pointer' : undefined }}
              onClick={() => canEdit && setEdit({ title: '', starts_on: s, ends_on: '', category: '전사', company_id: '', time_text: '', place: '', note: '' })}>
              <div style={{ fontSize: 12, fontWeight: s === today ? 700 : 400, color: !inM ? 'var(--muted)' : d.getDay() === 0 ? 'var(--red-s)' : d.getDay() === 6 ? 'var(--blue)' : undefined }}>{d.getDate()}</div>
              {list.slice(0, 4).map((e) => <button key={e.id} onClick={(ev) => { ev.stopPropagation(); setEdit(e); }} title={e.title}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 4, padding: '2px 5px', marginTop: 2, fontSize: 12, color: '#fff', background: CATS[e.category], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>
                {e.time_text ? e.time_text + ' ' : ''}{e.title}</button>)}
              {list.length > 4 && <div className="muted">+{list.length - 4}</div>}
            </div>); })}
        </div>
      </section>
      <section className="card">
        <h2>다가오는 일정</h2>
        {upcoming.map((e) => <div key={e.id} className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: CATS[e.category] }} /><b className="num">{e.starts_on.slice(5)}{e.ends_on ? '~' + e.ends_on.slice(5) : ''}</b>
          <button className="link" style={{ border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => setEdit(e)}>{e.title}</button>
          <span className="muted">{e.category === '회사' ? coName(e.company_id) : e.category}{e.place ? ' · ' + e.place : ''}</span></div>)}
        {!upcoming.length && <span className="sub">다가오는 일정이 없습니다.</span>}
      </section>
      {edit && <EventEdit e={edit} canWrite={canEdit && (!edit.id || edit.created_by === profile?.id || isAdmin) && !edit.post_id} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); data.reload(); }} />}
    </>
  );
}

function EventEdit({ e, canWrite, onClose, onSaved }: { e: any; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { companies } = useAuth();
  const [f, setF] = useState({ ...e, ends_on: e.ends_on || '', company_id: e.company_id || '', time_text: e.time_text || '', place: e.place || '', note: e.note || '' });
  const save = async () => {
    if (!f.title.trim()) return toast('제목을 넣어 주세요');
    if (f.category === '회사' && !f.company_id) return toast('회사별 일정은 회사를 골라 주세요');
    const row = { title: f.title.trim(), starts_on: f.starts_on, ends_on: f.ends_on && f.ends_on > f.starts_on ? f.ends_on : null, category: f.category, company_id: f.company_id || null, time_text: f.time_text || null, place: f.place || null, note: f.note || null };
    try { if (e.id) await q(sb.from('events').update(row).eq('id', e.id)); else await q(sb.from('events').insert(row)); onSaved(); } catch (x: any) { toast(x.message); }
  };
  const del = async () => { if (!confirm('이 일정을 지울까요?')) return; try { await q(sb.from('events').delete().eq('id', e.id)); onSaved(); } catch (x: any) { toast(x.message); } };
  return (
    <Modal title={e.id ? (canWrite ? '일정 고치기' : '일정') : '일정 추가'} onClose={onClose}
      foot={canWrite ? <>{e.id && <button className="btn" onClick={del}>지우기</button>}<button className="btn" onClick={onClose}>취소</button><button className="btn pri" onClick={save}>저장</button></> : undefined}>
      {e.post_id && <div className="banner blue"><span>게시판 공지에서 온 일정입니다. <Link to={`/space/board/${e.post_id}`}>공지 열기 ›</Link> (공지를 고치면 같이 바뀝니다)</span></div>}
      <div className="field"><label htmlFor="et">제목</label><input id="et" className="input" value={f.title} disabled={!canWrite} onChange={(x) => setF({ ...f, title: x.target.value })} /></div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="es">시작</label><input id="es" className="input" type="date" value={f.starts_on} disabled={!canWrite} onChange={(x) => setF({ ...f, starts_on: x.target.value })} /></div>
        <div className="field"><label htmlFor="ee">끝 (선택)</label><input id="ee" className="input" type="date" value={f.ends_on} disabled={!canWrite} onChange={(x) => setF({ ...f, ends_on: x.target.value })} /></div>
        <div className="field"><label htmlFor="eh">시각 (선택)</label><input id="eh" className="input" placeholder="10:00" value={f.time_text} disabled={!canWrite} onChange={(x) => setF({ ...f, time_text: x.target.value })} /></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="ec">구분</label><select id="ec" className="input" value={f.category} disabled={!canWrite} onChange={(x) => setF({ ...f, category: x.target.value })}>{Object.keys(CATS).map((k) => <option key={k} value={k}>{k === '회사' ? '회사별' : k}</option>)}</select></div>
        <div className="field"><label htmlFor="eco">회사</label><select id="eco" className="input" value={f.company_id} disabled={!canWrite} onChange={(x) => setF({ ...f, company_id: x.target.value })}><option value="">전체</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="ep">장소</label><input id="ep" className="input" value={f.place} disabled={!canWrite} onChange={(x) => setF({ ...f, place: x.target.value })} /></div>
      <div className="field"><label htmlFor="en">메모</label><textarea id="en" className="input" rows={3} value={f.note} disabled={!canWrite} onChange={(x) => setF({ ...f, note: x.target.value })} /></div>
    </Modal>
  );
}
