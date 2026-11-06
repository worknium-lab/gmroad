import { ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

/** 사진 전용 앱 틀: 파란 머리띠 + 넓은 본문. 이 화면에서 "홈 화면에 추가"하면 'GM 사진' 앱으로 깔림 */
export function PhotoShell({ title, back, right, children }: { title: string; back?: string; right?: ReactNode; children: ReactNode }) {
  const { profile } = useAuth();
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]');
    const meta = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
    const prev = [link?.href, meta?.content, document.title];
    if (link) link.href = '/photos.webmanifest';
    if (meta) meta.content = '#1F4E8C';
    document.title = 'GM 사진';
    return () => { if (link && prev[0]) link.href = prev[0]; if (meta && prev[1]) meta.content = prev[1]; document.title = prev[2] as string; };
  }, []);
  return (
    <div className="papp">
      <header className="phead">
        {back ? <Link to={back} className="ib" aria-label="뒤로">‹</Link> : <Link to={profile?.role === 'field' ? '/field' : '/'} className="ib" aria-label="통합관리로 가기">⌂</Link>}
        <h1>{title}</h1>
        {right}
      </header>
      <main className="pbody">{children}</main>
    </div>
  );
}
