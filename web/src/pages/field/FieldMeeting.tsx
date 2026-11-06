// 현장 앱 · 회의: 녹음 / 회의록 스캔 / 메모 → 본사 프로젝트 스토리에 올라감
import { useState } from 'react';
import { q, sb } from '../../lib/supabase';
import { dt } from '../../lib/format';
import { useLoad, Pill, Loading } from '../../lib/ui';
import { MSTATUS, Meeting } from '../../lib/meeting';
import MeetingStart, { Way } from '../project/meeting/MeetingStart';
import { useField } from './FieldShell';

export default function FieldMeeting() {
  const { pid } = useField();
  const [way, setWay] = useState<Way | null>(null);
  const list = useLoad(() => q<Meeting[]>(sb.from('meetings').select('*').eq('project_id', pid).order('held_at', { ascending: false }).limit(20)), [pid]);
  const mem = useLoad(() => q<any[]>(sb.from('project_members').select('profiles:user_id(id, name, username, role)').eq('project_id', pid)).then((x) => x.map((y) => y.profiles).filter(Boolean)), [pid]);
  return (
    <>
      <section className="card">
        <h2>회의 기록</h2>
        <button className="btn pri" style={{ background: 'var(--red-s)', borderColor: 'var(--red-s)', minHeight: 56 }} onClick={() => setWay('rec')}>● 회의 녹음</button>
        <button className="btn" style={{ minHeight: 52 }} onClick={() => setWay('hand')}>📷 수기 회의록 찍기</button>
        <button className="btn" style={{ minHeight: 52 }} onClick={() => setWay('file')}>녹음파일 올리기</button>
        <button className="btn" style={{ minHeight: 52 }} onClick={() => setWay('memo')}>메모</button>
        <div className="muted">올리면 본사에서 받아쓰기 · 요약을 확인하고 확정합니다.</div>
      </section>
      <section className="card">
        <h2>최근 회의록</h2>
        {list.loading ? <Loading /> : (list.data || []).map((m) => (
          <div key={m.id} style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
            <div className="row between"><b>{m.title}</b><Pill c={MSTATUS[m.status]?.[1]}>{MSTATUS[m.status]?.[0]}</Pill></div>
            <div className="muted">{dt(m.held_at)}{m.summary?.one_line ? ' · ' + m.summary.one_line : ''}</div>
          </div>))}
        {!list.loading && !list.data?.length && <span className="sub">아직 없습니다.</span>}
      </section>
      {way && <MeetingStart pid={pid} members={mem.data || []} way={way} onClose={() => setWay(null)} onDone={() => { setWay(null); list.reload(); }} />}
    </>
  );
}
