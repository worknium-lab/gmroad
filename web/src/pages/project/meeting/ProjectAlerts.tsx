// 프로젝트 알림칸: 회의록에서 뽑은 결정 · 기한 임박 할 일 · 미결 + 열린 자료요청 + 직접 올린 공지
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { q, sb } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { useLoad, useToast } from '../../../lib/ui';

const KIND: Record<string, string> = { decision: '결정', todo: '할 일', open: '미결', request: '자료요청', notice: '공지' };

export default function ProjectAlerts({ pid }: { pid: string }) {
  const toast = useToast();
  const { profile, canEdit } = useAuth();
  const [all, setAll] = useState(false);
  const data = useLoad(async () => {
    const [alerts, acks, reqs, todos] = await Promise.all([
      q<any[]>(sb.from('project_alerts').select('*, meetings(title)').eq('project_id', pid).eq('closed', false).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(60)),
      q<any[]>(sb.from('alert_acks').select('alert_id').eq('user_id', profile!.id)),
      q<any[]>(sb.from('requests').select('id, title, kind, due_at, to_user, created_at').eq('project_id', pid).eq('status', 'open').order('created_at', { ascending: false }).limit(20)),
      q<any[]>(sb.from('meeting_todos').select('id, done').eq('project_id', pid)),
    ]);
    return { alerts, acked: new Set(acks.map((a) => a.alert_id)), reqs, doneTodos: new Set(todos.filter((t) => t.done).map((t) => t.id)) };
  }, [pid]);
  if (!data.data) return null;
  const { alerts, acked, reqs, doneTodos } = data.data;
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const cards = [
    ...alerts.filter((a) => !(a.todo_id && doneTodos.has(a.todo_id))).map((a) => ({ ...a, acked: acked.has(a.id) })),
    ...reqs.map((r) => ({ id: 'r' + r.id, kind: 'request', text: r.title, due_date: r.due_at?.slice(0, 10), created_at: r.created_at, req: true, acked: false })),
  ].sort((a, b) => Number(a.acked) - Number(b.acked) || Number(!!b.pinned) - Number(!!a.pinned));
  const visible = all ? cards : cards.filter((c) => !c.acked);
  const ack = async (id: string) => { try { await q(sb.from('alert_acks').insert({ alert_id: id, user_id: profile!.id })); data.reload(); } catch (e: any) { toast(e.message); } };
  const close = async (id: string) => { try { await q(sb.from('project_alerts').update({ closed: true }).eq('id', id)); data.reload(); } catch (e: any) { toast(e.message); } };
  const notice = async () => {
    const text = prompt('알림칸에 올릴 공지'); if (!text?.trim()) return;
    try { await q(sb.from('project_alerts').insert({ project_id: pid, kind: 'notice', text: text.trim(), pinned: true })); data.reload(); } catch (e: any) { toast(e.message); }
  };
  if (!cards.length && !canEdit) return null;
  return (
    <section className="card" style={{ padding: 14, gap: 8 }} aria-label="프로젝트 알림">
      <div className="row between">
        <b>프로젝트 알림 {visible.length ? <span className="pill orange">{cards.filter((c) => !c.acked).length}</span> : null}</b>
        <div className="row">
          {cards.some((c) => c.acked) && <button className="btn sm" onClick={() => setAll(!all)}>{all ? '확인한 것 숨기기' : '확인한 것도 보기'}</button>}
          {canEdit && <button className="btn sm" onClick={notice}>+ 공지</button>}
        </div>
      </div>
      {!visible.length ? <span className="sub">새 알림이 없습니다. 회의록을 확정하면 결정사항 · 할 일 · 미결이 여기에 올라옵니다.</span> : (
        <div className="alerts">
          {visible.map((c: any) => {
            const late = c.due_date && c.due_date < today, near = c.due_date && c.due_date <= soon;
            return (
              <div key={c.id} className={`alert-card ${c.kind}${c.acked ? ' acked' : ''}`}>
                <div className="row between"><span className="pill">{KIND[c.kind]}{c.pinned ? ' · 고정' : ''}</span>
                  {c.due_date && <span className="muted" style={{ color: late ? 'var(--red-s)' : near ? 'var(--orange-d)' : undefined, fontWeight: near ? 700 : undefined }}>기한 {c.due_date}{late ? ' 지남' : ''}</span>}</div>
                <div style={{ fontSize: 14 }}>{c.text}</div>
                <div className="row between">
                  {c.meeting_id ? <Link className="muted" to={`/projects/${pid}/meeting?m=${c.meeting_id}`}>{c.meetings?.title}</Link> : c.req ? <Link className="muted" to={`/projects/${pid}/site`}>현장 자료요청</Link> : <span className="muted">공지</span>}
                  <div className="row" style={{ gap: 4 }}>
                    {!c.req && !c.acked && <button className="btn sm" onClick={() => ack(c.id)}>확인</button>}
                    {!c.req && canEdit && <button className="btn sm" onClick={() => close(c.id)} title="모두에게서 내림">내리기</button>}
                  </div>
                </div>
              </div>);
          })}
        </div>)}
    </section>
  );
}
