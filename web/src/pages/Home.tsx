import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { sb, q } from '../lib/supabase';
import { listProjects } from '../lib/data';
import { today, pct, REPORT, REQ, dt, dateK } from '../lib/format';
import { useLoad, Loading, ErrorBox, Pill, Bar, Empty } from '../lib/ui';

export default function Home() {
  const { profile, company } = useAuth();
  const { data, loading, error } = useLoad(async () => {
    const projects = (await listProjects(company)).filter((p) => p.status === 'active');
    const ids = projects.map((p) => p.id);
    const none = ['00000000-0000-0000-0000-000000000000'];
    const [reports, toMe, pending, crews] = await Promise.all([
      q<any[]>(sb.from('daily_reports').select('id, project_id, status, daily_equipment(id)').eq('report_date', today()).in('project_id', ids.length ? ids : none)),
      q<any[]>(sb.from('requests').select('*, projects(name)').eq('to_user', profile!.id).neq('status', 'done').order('due_at', { nullsFirst: false })),
      q<any[]>(sb.from('progress_entries').select('id, project_id').eq('status', 'pending').in('project_id', ids.length ? ids : none)),
      q<any[]>(sb.from('daily_crews').select('headcount, daily_reports!inner(project_id, report_date)').eq('daily_reports.report_date', today())),
    ]);
    const photos = ids.length ? await q<any[]>(sb.from('photos').select('project_id').gte('created_at', today() + 'T00:00:00').in('project_id', ids)) : [];
    return { projects, reports, toMe, pending, crews, photos };
  }, [company, profile?.id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  const d = data!;
  const rep = new Map(d.reports.map((r) => [r.project_id, r]));
  const ppl = (pid: string) => d.crews.filter((c) => c.daily_reports.project_id === pid).reduce((s, c) => s + c.headcount, 0);
  const submitted = d.reports.filter((r) => r.status !== 'draft').length;

  return (
    <>
      <div className="row between">
        <div><h1>안녕하세요, {profile?.name || profile?.username} 님</h1><p className="sub" style={{ margin: '4px 0 0' }}>{dateK(today())} · 오늘 확인할 일을 모았습니다.</p></div>
        <Link to="/projects" className="btn pri">프로젝트 목록</Link>
      </div>
      <div className="grid g4">
        <div className="stat"><span className="l">진행 중 프로젝트</span><span className="v">{d.projects.length}</span></div>
        <div className="stat"><span className="l">오늘 작업일보 제출</span><span className="v">{submitted} / {d.projects.length}</span><span className="s">미제출 {d.projects.length - submitted}곳</span></div>
        <div className="stat"><span className="l">나에게 온 요청</span><span className="v">{d.toMe.length}</span></div>
        <div className="stat"><span className="l">수량 승인 대기</span><span className="v">{d.pending.length}</span><span className="s">공정률 탭에서 승인</span></div>
      </div>
      <div className="grid g2">
        <section className="card">
          <h2>오늘 현장 현황</h2>
          {d.projects.length === 0 ? <Empty>진행 중인 프로젝트가 없습니다.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>현장</th><th>작업일보</th><th className="r">인원</th><th className="r">새 사진</th><th className="r">공정률</th></tr></thead>
              <tbody>{d.projects.map((p) => { const r = rep.get(p.id); const st = r ? REPORT[r.status] : ['미작성', 'red']; return (
                <tr key={p.id}><td><Link to={`/projects/${p.id}/site`}>{p.name}</Link></td><td><Pill c={st[1]}>{st[0]}</Pill></td>
                  <td className="r">{ppl(p.id) || '-'}</td><td className="r">{d.photos.filter((x) => x.project_id === p.id).length}</td>
                  <td className="r" style={{ minWidth: 110 }}><b>{pct(p.summary?.progress_pct)}</b><Bar v={Number(p.summary?.progress_pct || 0)} /></td></tr>); })}</tbody>
            </table></div>)}
        </section>
        <section className="card">
          <h2>나에게 온 요청</h2>
          {d.toMe.length === 0 ? <Empty>받은 요청이 없습니다.</Empty> : d.toMe.map((r) => (
            <div key={r.id} className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 10 }}>
              <Pill c="blue">{r.kind}</Pill>
              <div style={{ flex: 1, minWidth: 0 }}><b>{r.title}</b><div className="muted">{r.projects?.name}</div></div>
              <Pill c={REQ[r.status][1]}>{REQ[r.status][0]}</Pill><span className="muted">{r.due_at ? dt(r.due_at) : ''}</span>
            </div>))}
        </section>
      </div>
    </>
  );
}
