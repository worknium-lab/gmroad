import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sb, q } from '../../lib/supabase';
import { signedUrls } from '../../lib/files';
import { useAuth } from '../../lib/auth';
import { useField } from './FieldShell';
import { dt, REQ } from '../../lib/format';
import { useToast, Pill } from '../../lib/ui';

export default function FieldRequests() {
  const { profile } = useAuth();
  const { pid } = useField();
  const toast = useToast();
  const [reqs, setReqs] = useState<any[]>([]);
  const [dwgs, setDwgs] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = async () => {
    const [r, d] = await Promise.all([
      q<any[]>(sb.from('requests').select('*, from:profiles!requests_from_user_fkey(name, username)').eq('project_id', pid).eq('to_user', profile!.id).order('status').order('due_at', { nullsFirst: false }).limit(30)),
      q<any[]>(sb.from('documents').select('*').eq('project_id', pid).eq('category', 'drawing').order('file_name')),
    ]);
    setReqs(r); setDwgs(d);
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile!.id).eq('project_id', pid).is('read_at', null);
  };
  useEffect(() => { load().catch((e) => toast(e.message)); }, [pid]);
  const answer = async (r: any) => {
    try { await q(sb.from('requests').update({ status: 'done', answer_note: notes[r.id] || '확인', answered_at: new Date().toISOString() }).eq('id', r.id)); toast('응답했습니다'); load(); } catch (e: any) { toast(e.message); }
  };
  const open = async (d: any) => { const u = await signedUrls([d.storage_path]); window.open(u[d.storage_path], '_blank'); };
  return (
    <>
      <section className="fcard"><h2>본사 요청</h2>
        {!reqs.length && <span className="sub">받은 요청이 없습니다.</span>}
        {reqs.map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid var(--line-2)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row between"><b>{r.title}</b><Pill c={REQ[r.status][1]}>{REQ[r.status][0]}</Pill></div>
            <span className="muted">{r.kind} · {r.from?.name || r.from?.username}{r.due_at ? ' · 마감 ' + dt(r.due_at) : ''}</span>
            {r.body && <span style={{ fontSize: 13 }}>{r.body}</span>}
            {r.status !== 'done' && <div className="row" style={{ flexWrap: 'nowrap' }}>
              {r.kind === '사진' ? <Link className="btn teal sm" to="/field/photo">사진 올려서 응답</Link> : <>
                <input aria-label="응답 메모" className="input" style={{ height: 40 }} placeholder="응답 메모" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <button className="btn teal sm" onClick={() => answer(r)}>완료</button></>}
            </div>}
            {r.answer_note && <span className="muted">응답: {r.answer_note}</span>}
          </div>))}
      </section>
      <section className="fcard"><h2>도면 {dwgs.length}장</h2>
        {dwgs.map((d) => <button key={d.id} className="row between" onClick={() => open(d)} style={{ border: 0, borderTop: '1px solid var(--line-2)', background: 'none', minHeight: 44, cursor: 'pointer', textAlign: 'left' }}><span>{d.file_name}</span><span className="muted">v{d.version}</span></button>)}
        {!dwgs.length && <span className="sub">본사에서 설계도면을 올리면 여기 보입니다.</span>}
      </section>
    </>
  );
}
