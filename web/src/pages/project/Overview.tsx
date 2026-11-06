import { ProjectDeliveries } from '../products/Products';
import { useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { Project } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { won, period, ROLE, dt } from '../../lib/format';
import { useLoad, Pill, useToast, Modal } from '../../lib/ui';

export default function Overview({ p }: { p: Project }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [add, setAdd] = useState(false);
  const { data, reload } = useLoad(async () => {
    const [members, acts, people] = await Promise.all([
      q<any[]>(sb.from('project_members').select('*, profiles(id, name, username, role)').eq('project_id', p.id)),
      q<any[]>(sb.from('daily_reports').select('report_date, status, submitted_at').eq('project_id', p.id).order('report_date', { ascending: false }).limit(6)),
      q<any[]>(sb.from('profiles').select('id, name, username, role').eq('active', true).order('name')),
    ]);
    return { members, acts, people };
  }, [p.id]);
  const toggle = async (m: any, k: string) => { await q(sb.from('project_members').update({ [k]: !m[k] }).eq('project_id', p.id).eq('user_id', m.user_id)); reload(); };
  const remove = async (m: any) => { await q(sb.from('project_members').delete().eq('project_id', p.id).eq('user_id', m.user_id)); reload(); };
  const addMember = async (uid: string) => { try { await q(sb.from('project_members').insert({ project_id: p.id, user_id: uid })); setAdd(false); reload(); } catch (e: any) { toast(e.message); } };

  return (
    <div className="grid g2">
      <section className="card"><h2>기본정보</h2>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '140px 1fr', gap: '10px 16px' }}>
          <dt className="sub">공사명</dt><dd style={{ margin: 0 }}>{p.name}</dd>
          <dt className="sub">발주처</dt><dd style={{ margin: 0 }}>{p.client || '-'}</dd>
          <dt className="sub">도급사 · 도급금액</dt><dd style={{ margin: 0 }}>{p.prime_contractor || '-'} · {won(p.prime_amount)}원</dd>
          <dt className="sub">하도급사(특허사)</dt><dd style={{ margin: 0 }}>{p.project_subcontracts.length ? p.project_subcontracts.map((s) => <div key={s.id}>{s.name} · {won(s.amount)}원 {s.is_patent && <Pill c="blue">특허</Pill>}</div>) : '-'}</dd>
          <dt className="sub">공사기간</dt><dd style={{ margin: 0 }}>{period(p.start_date, p.end_date)}</dd>
          <dt className="sub">특허반영공법</dt><dd style={{ margin: 0 }}>{p.patent_method || '-'}</dd>
          {p.memo && <><dt className="sub">메모</dt><dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{p.memo}</dd></>}
        </dl>
      </section>
      <section className="card">
        <div className="card-h"><h2>참여자 · 권한</h2>{canEdit && <button className="btn sm" onClick={() => setAdd(true)}>+ 참여자</button>}</div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>이름</th><th>역할</th><th className="c">내역서·금액</th><th className="c">노무비</th><th className="c">현장 입력</th><th /></tr></thead>
          <tbody>{data?.members.map((m) => (
            <tr key={m.user_id}><td>{m.profiles?.name || m.profiles?.username}</td><td><span className="muted">{ROLE[m.profiles?.role]}</span></td>
              {['can_boq', 'can_labor', 'can_field'].map((k) => <td key={k} className="c"><input type="checkbox" aria-label={k} checked={m[k]} disabled={!canEdit} onChange={() => toggle(m, k)} style={{ width: 18, height: 18 }} /></td>)}
              <td>{canEdit && <button className="link" onClick={() => remove(m)}>빼기</button>}</td></tr>))}</tbody>
        </table></div>
        <span className="muted">현장 담당자는 여기 배정된 현장만 현장 앱에서 볼 수 있습니다.</span>
      </section>
      <section className="card"><h2>최근 작업일보</h2>
        {data?.acts.length ? data.acts.map((a) => <div key={a.report_date} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}><span>{a.report_date}</span><span className="muted">{a.submitted_at ? '제출 ' + dt(a.submitted_at) : a.status}</span></div>) : <span className="sub">아직 작업일보가 없습니다.</span>}
      </section>
      <ProjectDeliveries pid={p.id} />
      {add && <Modal title="참여자 추가" onClose={() => setAdd(false)}>
        {data?.people.filter((x) => !data.members.some((m) => m.user_id === x.id)).map((x) => (
          <button key={x.id} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => addMember(x.id)}><span>{x.name || x.username} ({x.username})</span><span className="muted">{ROLE[x.role]}</span></button>))}
      </Modal>}
    </div>
  );
}
