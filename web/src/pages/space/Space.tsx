// 공용공간 홈 · 사내 연락처
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { q, sb } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { dt } from '../../lib/format';
import { useLoad, Loading, ErrorBox, Pill, useToast } from '../../lib/ui';
import { KIND, CATS, myPosts, myReads, spaceDownload, kb } from '../../lib/space';

export function SpaceHome() {
  const toast = useToast();
  const { company, companies } = useAuth();
  const data = useLoad(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [posts, reads, evs, files] = await Promise.all([
      q<any[]>(myPosts().limit(60)), myReads(),
      q<any[]>(sb.from('events').select('*').gte('starts_on', today).order('starts_on').limit(20)),
      q<any[]>(sb.from('library_files').select('*').eq('is_latest', true).order('created_at', { ascending: false }).limit(40)),
    ]);
    return { posts, reads: new Map(reads.map((r) => [r.post_id, r])), evs, files };
  }, []);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('posts') || data.error.includes('events') ? '공용공간 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error} />;
  const d = data.data!;
  const mine = (p: any) => company === 'all' || !(p.target_companies || []).length || p.target_companies.includes(company);
  const must = d.posts.filter((p) => p.must_read && !d.reads.get(p.id)?.confirmed_at);
  const recent = d.posts.filter(mine).slice(0, 8);
  const evs = d.evs.filter((e) => company === 'all' || !e.company_id || e.company_id === company).slice(0, 6);
  const files = d.files.filter((f) => f.folder !== '양식함' && (company === 'all' || !f.company_id || f.company_id === company)).slice(0, 6);
  const forms = d.files.filter((f) => f.folder === '양식함').slice(0, 8);
  const coName = (id?: string) => companies.find((c) => c.id === id)?.name || '';
  return (
    <>
      <h1>회사 공용공간</h1>
      {must.length > 0 && <section className="card" style={{ borderLeft: '4px solid var(--red-s)' }}>
        <h2>확인하지 않은 필독 {must.length}건</h2>
        {must.map((p) => <Link key={p.id} to={`/space/board/${p.id}`} className="row between" style={{ textDecoration: 'none', color: 'inherit', borderTop: '1px solid var(--line-2)', paddingTop: 8, minHeight: 40 }}>
          <span><Pill c="red">필독</Pill> <b>{p.title}</b></span><span className="muted">{dt(p.publish_at)} · 확인하기 ›</span></Link>)}
      </section>}
      <div className="g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <section className="card">
          <div className="card-h"><h2>최근 글</h2><Link to="/space/board">게시판 ›</Link></div>
          {recent.map((p) => <Link key={p.id} to={`/space/board/${p.id}`} className="row between" style={{ textDecoration: 'none', color: 'inherit', borderTop: '1px solid var(--line-2)', paddingTop: 8, minHeight: 40 }}>
            <span><Pill c={p.kind === 'notice' ? 'blue' : ''}>{KIND[p.kind]}</Pill> {p.pinned && '📌 '}<span style={{ fontWeight: d.reads.get(p.id) ? 400 : 700 }}>{p.title}</span></span>
            <span className="muted">{p.profiles?.name} · {dt(p.publish_at)}</span></Link>)}
          {!recent.length && <span className="sub">아직 글이 없습니다.</span>}
        </section>
        <section className="card">
          <div className="card-h"><h2>다가오는 일정</h2><Link to="/space/calendar">달력 ›</Link></div>
          {evs.map((e) => <div key={e.id} className="row" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CATS[e.category] }} /><b className="num">{e.starts_on.slice(5).replace('-', '/')}</b><span>{e.title}</span>
            <span className="muted">{e.category === '회사' ? coName(e.company_id) : e.category}</span></div>)}
          {!evs.length && <span className="sub">다가오는 일정이 없습니다.</span>}
        </section>
        <section className="card">
          <div className="card-h"><h2>새 자료</h2><Link to="/space/library">자료실 ›</Link></div>
          {files.map((f) => <div key={f.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 6 }}>
            <span><b>{f.title}</b> <span className="muted">{f.folder} · v{f.version} · {kb(f.size_bytes)}</span></span>
            <button className="btn sm" onClick={() => spaceDownload(f.path, f.file_name).catch((e) => toast(e.message))}>받기</button></div>)}
          {!files.length && <span className="sub">아직 자료가 없습니다.</span>}
        </section>
        <section className="card">
          <div className="card-h"><h2>양식</h2><Link to="/space/library">양식함 ›</Link></div>
          <Link to="/me" className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 6, textDecoration: 'none', color: 'inherit' }}><b>재직증명서</b><span className="muted">바로 발급 ›</span></Link>
          {forms.map((f) => <div key={f.id} className="row between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 6 }}>
            <span>{f.title}</span><button className="btn sm" onClick={() => spaceDownload(f.path, f.file_name).catch((e) => toast(e.message))}>받기</button></div>)}
        </section>
      </div>
    </>
  );
}

export function Directory() {
  const { companies, company } = useAuth();
  const [find, setFind] = useState('');
  const data = useLoad(() => q<any[]>(sb.from('v_directory').select('*').order('name')), []);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('v_directory') ? '연락처를 아직 쓸 수 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error} />;
  const f = find.replace(/\s/g, '');
  const list = (data.data || []).filter((u) => (company === 'all' || u.company_id === company) && (!f || (u.name + (u.dept || '') + (u.rank || '') + (u.position || '') + (u.phone || '') + (u.email || '')).replace(/\s/g, '').includes(f)));
  const groups = [...companies.map((c) => ({ id: c.id, name: c.name })), { id: '', name: '회사 미지정' }]
    .map((c) => ({ ...c, us: list.filter((u) => (u.company_id || '') === c.id) })).filter((g) => g.us.length);
  return (
    <>
      <div className="row between"><h1>사내 연락처</h1><input className="input" style={{ width: 240 }} placeholder="이름 · 부서 · 번호 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="연락처 찾기" /></div>
      <div className="muted">인사정보에서 자동으로 채워집니다. 휴대폰은 본인이 '내 정보'에서 공개로 둔 경우만 보입니다.</div>
      {groups.map((g) => {
        const depts = [...new Set(g.us.map((u) => u.dept || '부서 미지정'))];
        return (
          <section key={g.id} className="card">
            <h2>{g.name} <span className="muted">{g.us.length}명</span></h2>
            {depts.map((dp) => (
              <div key={dp}>
                <div className="muted" style={{ fontWeight: 700, margin: '6px 0' }}>{dp}</div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
                  {g.us.filter((u) => (u.dept || '부서 미지정') === dp).map((u) => (
                    <div key={u.id} className="card" style={{ padding: 12, gap: 2 }}>
                      <b>{u.name || u.username} <span className="muted">{[u.rank, u.position].filter(Boolean).join(' · ')}</span></b>
                      {u.phone ? <a href={`tel:${u.phone}`}>{u.phone}</a> : <span className="muted">휴대폰 비공개</span>}
                      {u.email && <a href={`mailto:${u.email}`} className="muted">{u.email}</a>}
                    </div>))}
                </div>
              </div>))}
          </section>);
      })}
      {!groups.length && <div className="empty">찾는 사람이 없습니다.</div>}
    </>
  );
}
