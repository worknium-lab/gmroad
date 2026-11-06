import { LicenseBanner } from '../../lib/license';
import { logout } from '../../lib/push';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { sb, q } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { myProjects } from '../../lib/data';
import { today } from '../../lib/format';

type FCtx = { pid: string; projects: { id: string; name: string }[]; report: any; ensureReport: () => Promise<any>; reloadReport: () => Promise<void> };
const F = createContext<FCtx>(null as any);
export const useField = () => useContext(F);

export function FieldShell({ title, children, back }: { title?: string; children: ReactNode; back?: string }) {
  const { profile, canEdit } = useAuth();
  const nav = useNavigate();
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [pid, setPid] = useState(localStorage.getItem('gm.fieldProject') || '');
  const [report, setReport] = useState<any>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => { myProjects().then((ps) => { setProjects(ps); if (!ps.some((p) => p.id === pid) && ps[0]) choose(ps[0].id); }); }, []);
  const choose = (id: string) => { setPid(id); localStorage.setItem('gm.fieldProject', id); };
  const reloadReport = async () => { if (!pid) return; setReport(await q(sb.from('daily_reports').select('*').eq('project_id', pid).eq('report_date', today()).maybeSingle())); };
  useEffect(() => { reloadReport(); }, [pid]);
  useEffect(() => {
    if (!profile) return;
    const load = () => sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).then(({ count }) => setUnread(count || 0));
    load(); const ch = sb.channel('fnt').on('postgres_changes', { event: '*', schema: 'gm', table: 'notifications', filter: `user_id=eq.${profile.id}` }, load).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [profile]);
  const ensureReport = async () => {
    if (report) return report;
    const r = await q<any>(sb.from('daily_reports').upsert({ project_id: pid, report_date: today() }, { onConflict: 'project_id,report_date' }).select().single());
    setReport(r); return r;
  };

  return (
    <F.Provider value={{ pid, projects: projects || [], report, ensureReport, reloadReport }}>
      <div className="fapp">
        <header className="fhead">
          {back ? <Link to={back} className="ib" aria-label="뒤로">‹</Link> : canEdit ? <Link to="/" className="ib" aria-label="본사 화면으로">⌂</Link> : null}
          {title ? <h1>{title}</h1> : (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="fp" style={{ fontSize: 12, color: '#CDE8E3' }}>현장</label>
              <select id="fp" value={pid} onChange={(e) => choose(e.target.value)}>{(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>)}
          <button className="ib" aria-label={`알림 ${unread}건`} onClick={() => nav('/field/requests')}>🔔{unread > 0 && <span className="dot" />}</button>
          {!canEdit && <button className="ib" aria-label="로그아웃" onClick={() => logout()} style={{ fontSize: 12 }}>나가기</button>}
        </header>
        <LicenseBanner />
        <div className="fbody">
          {projects && !projects.length ? <div className="empty">배정된 현장이 없습니다. 본사에 현장 배정을 요청하세요.</div> : pid ? children : null}
        </div>
        <nav className="ftabs" aria-label="현장 앱 메뉴">
          {[['/field', '오늘'], ['/field/qty', '수량 입력'], ['/field/photo', '사진'], ['/field/material', '자재'], ['/field/requests', '도면·알림']].map(([to, l]) =>
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}
        </nav>
      </div>
    </F.Provider>
  );
}
