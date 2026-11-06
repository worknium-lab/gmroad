import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { pct, period, won } from '../../lib/format';
import { useLoad, Loading, ErrorBox, Bar } from '../../lib/ui';
import ProjectForm from '../../components/ProjectForm';
import Overview from './Overview';
import Docs from './Docs';
import Structure from './Structure';
import Site from './Site';
import Progress from './Progress';
import Materials from './Materials';

const TABS: [string, string, boolean][] = [
  ['overview', '① 개요', false], ['docs', '② 설계·계약서류', false], ['structure', '③ 공사 구성', false], ['boq', '④ 내역서', false], ['construction', '⑤ 공사서류', false],
  ['site', '⑥ 현장 현황', true], ['progress', '⑦ 공정률', true], ['materials', '⑧ 자재', true], ['labor', '⑨ 노무비', true], ['meeting', '⑩ 회의록', true],
];
const NEXT: Record<string, string> = { boq: '내역서 (설계 → 도급 → 변경 → 준공, 엑셀 수식 보존)', labor: '노무비 (전자카드 → 명세서 → 근로계약서)', meeting: '회의록 (녹음 받아쓰기 · 요약 · 태블릿 노트)' };

export default function ProjectPage() {
  const { id = '', tab = 'overview' } = useParams();
  const { canEdit, companies } = useAuth();
  const [edit, setEdit] = useState(false);
  const { data: p, loading, error, reload } = useLoad(() => getProject(id), [id]);
  if (loading) return <Loading />;
  if (error || !p) return <ErrorBox msg={error || '프로젝트를 찾을 수 없습니다'} />;
  const subSum = p.project_subcontracts.reduce((s, x) => s + Number(x.amount || 0), 0);

  return (
    <>
      <nav className="crumb" aria-label="위치"><Link to="/projects">프로젝트</Link> › {p.name}</nav>
      <section className="card" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '16px 32px' }}>
        <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted">{companies.find((c) => c.id === p.company_id)?.name}</span>
          <h1 style={{ fontSize: 22 }}>{p.name}</h1>
          <span className="sub" style={{ fontSize: 13 }}>{p.client || '발주처 미입력'} · {period(p.start_date, p.end_date)}{p.patent_method ? ' · ' + p.patent_method : ''}</span>
        </div>
        <div className="row" style={{ gap: 28 }}>
          <div><div className="muted">도급금액</div><b className="num" style={{ fontSize: 17 }}>{won(p.prime_amount)}</b></div>
          <div><div className="muted">하도급액 ({p.project_subcontracts.length}곳)</div><b className="num" style={{ fontSize: 17 }}>{won(subSum)}</b></div>
          <div style={{ minWidth: 130 }}><div className="muted">공정률</div><b style={{ fontSize: 17 }}>{pct(p.summary?.progress_pct)}</b><Bar v={Number(p.summary?.progress_pct || 0)} /></div>
          {canEdit && <button className="btn sm" onClick={() => setEdit(true)}>정보 수정</button>}
        </div>
      </section>
      <div role="tablist" aria-label="프로젝트 탭" className="tabs scroll">
        <span className="lbl">문서</span>
        {TABS.slice(0, 5).map(([k, l]) => <Link key={k} role="tab" aria-selected={tab === k} to={`/projects/${id}/${k}`} className={tab === k ? 'on' : ''}>{l}</Link>)}
      </div>
      <div role="tablist" aria-label="현장 탭" className="tabs scroll" style={{ marginTop: -8 }}>
        <span className="lbl" style={{ color: 'var(--teal)' }}>현장</span>
        {TABS.slice(5).map(([k, l]) => <Link key={k} role="tab" aria-selected={tab === k} to={`/projects/${id}/${k}`} className={'site' + (tab === k ? ' on' : '')}>{l}</Link>)}
      </div>

      {tab === 'overview' && <Overview p={p} />}
      {tab === 'docs' && <Docs pid={id} mode="design" />}
      {tab === 'construction' && <Docs pid={id} mode="construction" />}
      {tab === 'structure' && <Structure pid={id} />}
      {tab === 'site' && <Site pid={id} />}
      {tab === 'progress' && <Progress pid={id} onChange={reload} />}
      {tab === 'materials' && <Materials pid={id} />}
      {NEXT[tab] && <div className="empty"><b>{NEXT[tab]}</b><br />다음 단계에서 만듭니다. 화면 설계는 디자인 캔버스에 있습니다.</div>}

      {edit && <ProjectForm project={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </>
  );
}
