import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { sb } from '../lib/supabase';
import { ROLE } from '../lib/format';

type Item = { to: string; label: string; match?: string };
export function Shell({ children }: { children: ReactNode }) {
  const { profile, companies, company, setCompany, isAdmin } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!profile) return;
    const load = () => sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).then(({ count }) => setUnread(count || 0));
    load();
    const ch = sb.channel('nt-' + profile.id).on('postgres_changes', { event: '*', schema: 'gm', table: 'notifications', filter: `user_id=eq.${profile.id}` }, load).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [profile]);

  const groups: { head: string; lock?: boolean; items: Item[] }[] = [
    { head: '', items: [{ to: '/', label: '홈' }] },
    { head: '프로젝트', items: [{ to: '/projects', label: '프로젝트 목록 · 통계', match: '/projects' }] },
    { head: '현장', items: [{ to: '/field', label: '현장 앱 열기' }] },
    { head: '내 정보', items: [{ to: '/me', label: '인사정보 · 비밀번호' }] },
  ];
  if (isAdmin) groups.push({ head: '관리자', lock: true, items: [{ to: '/admin/users', label: '사용자 · 권한' }, { to: '/admin/companies', label: '회사 관리' }] });
  const isOn = (i: Item) => (i.match ? loc.pathname.startsWith(i.match) : loc.pathname === i.to);

  return (
    <div className="app">
      <nav className="nav" aria-label="주 메뉴">
        <Link to="/" className="brand"><b>GM 통합관리</b><span>지엠로드 · 지엠알 · OO엔지니어링</span></Link>
        {groups.map((g) => (
          <div key={g.head || 'home'} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.head && <div className="gh">{g.head}{g.lock && <i>관리자 전용</i>}</div>}
            {g.items.map((i) => <NavLink key={i.to} to={i.to} className={() => 'nv' + (isOn(i) ? ' on' : '')}>{i.label}</NavLink>)}
          </div>
        ))}
        <div style={{ marginTop: 'auto', fontSize: 11, color: '#8695AE', padding: '0 10px' }}>1차 버전 · 내역서 · 노무비 · 회의록 · 공용공간은 다음 단계</div>
      </nav>
      <div className="main">
        <header className="top">
          <div className="seg" role="group" aria-label="회사 선택">
            <button className={company === 'all' ? 'on' : ''} onClick={() => setCompany('all')}>전체</button>
            {companies.map((c) => <button key={c.id} className={company === c.id ? 'on' : ''} onClick={() => setCompany(c.id)}>{c.name}</button>)}
          </div>
          <span className="grow" />
          <button className="btn sm" onClick={() => nav('/notifications')} aria-label={`알림 ${unread}건`} style={{ position: 'relative' }}>
            알림{unread > 0 && <span className="pill red" style={{ marginLeft: 4 }}>{unread}</span>}
          </button>
          <Link to="/me" className="hide-m" style={{ display: 'flex', flexDirection: 'column', textDecoration: 'none', color: 'inherit' }}>
            <b style={{ fontSize: 14 }}>{profile?.name || profile?.username}</b><span className="muted">{ROLE[profile?.role || '']}</span>
          </Link>
          <button className="btn sm hide-m" onClick={() => sb.auth.signOut()}>로그아웃</button>
        </header>
        <main className="page">{children}</main>
      </div>
      <nav className="mtabs" aria-label="하단 메뉴">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>홈</NavLink>
        <NavLink to="/projects" className={({ isActive }) => (isActive ? 'on' : '')}>프로젝트</NavLink>
        <NavLink to="/field" className={({ isActive }) => (isActive ? 'on' : '')}>현장 앱</NavLink>
        <NavLink to="/notifications" className={({ isActive }) => (isActive ? 'on' : '')}>알림{unread ? ` ${unread}` : ''}</NavLink>
        <NavLink to="/me" className={({ isActive }) => (isActive ? 'on' : '')}>더보기</NavLink>
      </nav>
    </div>
  );
}
