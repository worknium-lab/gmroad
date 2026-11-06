import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { listProjects } from '../lib/data';
import { won, eok, pct, period, STATUS } from '../lib/format';
import { useLoad, Loading, ErrorBox, Pill, Bar, Seg, Empty } from '../lib/ui';
import ProjectForm from '../components/ProjectForm';

export default function Projects() {
  const { company, companies, canEdit } = useAuth();
  const nav = useNavigate();
  const [view, setView] = useState<'list' | 'stats' | 'prog'>('list');
  const [status, setStatus] = useState('active');
  const [kw, setKw] = useState('');
  const [form, setForm] = useState(false);
  const { data, loading, error, reload } = useLoad(() => listProjects(company), [company]);
  const coName = (id: string) => companies.find((c) => c.id === id)?.name || '';
  const rows = useMemo(() => (data || []).filter((p) => (status === 'all' || p.status === status) && (!kw || p.name.includes(kw) || (p.client || '').includes(kw))), [data, status, kw]);

  const stats = useMemo(() => {
    const all = data || [];
    const by = (key: (p: any) => string, val: (p: any) => number) => {
      const m = new Map<string, number>(); all.forEach((p) => m.set(key(p) || '-', (m.get(key(p) || '-') || 0) + val(p)));
      const arr = [...m.entries()].sort((a, b) => b[1] - a[1]); const mx = Math.max(1, ...arr.map((x) => x[1])); return arr.map(([l, v]) => ({ l, v, w: (v / mx) * 100 }));
    };
    return {
      prime: all.reduce((s, p) => s + Number(p.prime_amount || 0), 0),
      sub: all.reduce((s, p) => s + Number(p.summary?.sub_amount || 0), 0),
      active: all.filter((p) => p.status === 'active').length, done: all.filter((p) => p.status === 'done').length,
      patent: all.filter((p) => p.patent_method).length,
      byCompany: by((p) => coName(p.company_id), (p) => Number(p.summary?.sub_amount || 0)),
      byClient: by((p) => p.client, (p) => Number(p.prime_amount || 0)),
    };
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  return (
    <>
      <div className="row between">
        <div><h1>프로젝트</h1><p className="sub" style={{ margin: '4px 0 0' }}>진행 {stats.active} · 완료 {stats.done}</p></div>
        <div className="row">
          <Seg label="보기" value={view} onChange={setView} items={[['list', '목록'], ['stats', '통계'], ['prog', '공정률 현황']]} />
          {canEdit && <button className="btn pri" onClick={() => setForm(true)}>+ 프로젝트 등록</button>}
        </div>
      </div>

      {view === 'list' && <>
        <div className="row">
          <select aria-label="상태" className="input" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">전체</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input aria-label="검색" className="input" style={{ width: 260 }} placeholder="공사명 · 발주처 검색" value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
        {rows.length === 0 ? <Empty>프로젝트가 없습니다. {canEdit && '오른쪽 위 \'프로젝트 등록\'으로 추가하세요.'}</Empty> : (
          <section className="card flat"><div className="tbl-wrap"><table className="tbl" style={{ minWidth: 1100 }}>
            <thead><tr><th>공사명 · 회사</th><th>발주처</th><th>도급사 · 도급금액</th><th>하도급사(특허사) · 하도급액</th><th>공사기간</th><th>특허반영공법</th><th className="r">공정률</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/projects/${p.id}`)}>
                <td><Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}><b>{p.name}</b></Link><div className="muted">{coName(p.company_id)} · {STATUS[p.status]}</div></td>
                <td>{p.client || '-'}</td>
                <td>{p.prime_contractor || '-'}<div className="num" style={{ fontWeight: 700, marginTop: 4 }}>{won(p.prime_amount)}</div></td>
                <td>{p.project_subcontracts.length ? p.project_subcontracts.map((s) => (
                  <div key={s.id} className="row between" style={{ flexWrap: 'nowrap' }}><span>{s.name}{s.is_patent && <Pill c="blue">특허</Pill>}</span><span className="num">{won(s.amount)}</span></div>)) : '-'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{period(p.start_date, p.end_date)}</td>
                <td>{p.patent_method ? <Pill c="blue">{p.patent_method}</Pill> : '-'}</td>
                <td className="r"><b>{pct(p.summary?.progress_pct)}</b></td>
              </tr>))}</tbody>
          </table></div></section>)}
      </>}

      {view === 'stats' && <>
        <div className="grid g4">
          <div className="stat"><span className="l">도급액 합계</span><span className="v">{eok(stats.prime)}</span></div>
          <div className="stat"><span className="l">하도급 수주액 합계</span><span className="v">{eok(stats.sub)}</span></div>
          <div className="stat"><span className="l">진행 / 완료</span><span className="v">{stats.active} / {stats.done}</span></div>
          <div className="stat"><span className="l">특허공법 적용</span><span className="v">{stats.patent}건</span></div>
        </div>
        <div className="grid g2">
          {[['회사별 하도급 수주액', stats.byCompany], ['발주처별 도급액', stats.byClient]].map(([t, rs]: any) => (
            <section key={t} className="card"><h2>{t}</h2>
              {rs.map((r: any) => <div key={r.l} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 100px', gap: 12, alignItems: 'center' }}><span>{r.l}</span><Bar v={r.w} /><span className="num" style={{ textAlign: 'right' }}>{eok(r.v)}</span></div>)}
            </section>))}
        </div>
      </>}

      {view === 'prog' && (
        <section className="card"><h2>전체 공정률 현황 (금액 기준 · 승인된 입력)</h2>
          {(data || []).filter((p) => p.status === 'active').map((p) => (
            <Link key={p.id} to={`/projects/${p.id}/progress`} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 280px) 1fr 70px', gap: 16, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--line-2)', textDecoration: 'none', color: 'inherit' }}>
              <span>{p.name}</span><Bar v={Number(p.summary?.progress_pct || 0)} /><b className="num" style={{ textAlign: 'right' }}>{pct(p.summary?.progress_pct)}</b>
            </Link>))}
        </section>)}

      {form && <ProjectForm onClose={() => setForm(false)} onSaved={(id) => { setForm(false); reload(); nav(`/projects/${id}`); }} />}
    </>
  );
}
