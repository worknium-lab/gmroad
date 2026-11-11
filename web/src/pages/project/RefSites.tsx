// PJ-10 개요 맨 아래 · 참고 현장: 같은 발주처의 다른 현장을 버튼으로 보여 주고, 누르면 그 현장으로 넘어감
//   기준은 발주처 하나만. 볼 수 있는 프로젝트만 나옴 (권한은 DB가 지킴)
import { useNavigate } from 'react-router-dom';
import { sb, q } from '../../lib/supabase';
import { Project } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { won, period, STATUS } from '../../lib/format';
import { useLoad, Pill } from '../../lib/ui';

const COLOR: Record<string, string> = { active: 'blue', done: 'green', planned: 'orange', hold: '' };

export default function RefSites({ p }: { p: Project }) {
  const nav = useNavigate();
  const { companies } = useAuth();
  const client = (p.client || '').trim();
  const { data, loading } = useLoad(async () => {
    if (!client) return [];
    return q<any[]>(sb.from('projects').select('id, name, company_id, start_date, end_date, prime_amount, status')
      .eq('client', client).neq('id', p.id)
      .order('start_date', { ascending: false, nullsFirst: false }).limit(30));
  }, [p.id, client]);

  return (
    <section className="card" style={{ gridColumn: '1 / -1' }}>
      <div className="card-h"><h2>참고 현장</h2><span className="muted">{client ? `발주처 '${client}'의 다른 현장` : ''}</span></div>
      {!client ? <span className="sub">발주처가 비어 있습니다. 프로젝트 수정에서 발주처를 넣으면 같은 발주처 현장이 여기에 나옵니다.</span>
        : loading ? <span className="sub">찾는 중…</span>
        : !data?.length ? <span className="sub">같은 발주처의 다른 현장이 아직 없습니다.</span>
        : <div className="refsites">{data.map((r) => (
          <button key={r.id} className="refsite" onClick={() => nav(`/projects/${r.id}`)}>
            <span className="row between" style={{ flexWrap: 'nowrap' }}>
              <b>{r.name}</b><Pill c={COLOR[r.status]}>{r.status === 'done' ? '완료' : STATUS[r.status] || r.status}</Pill>
            </span>
            <span className="muted">{period(r.start_date, r.end_date)}</span>
            <span className="row between" style={{ flexWrap: 'nowrap' }}>
              <span className="muted">{companies.find((c) => c.id === r.company_id)?.name}</span>
              <span className="num">{won(r.prime_amount)}원</span>
            </span>
          </button>))}</div>}
    </section>
  );
}
