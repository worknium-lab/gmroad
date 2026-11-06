// 게시판: 목록 · 글 보기(필독 확인 · 읽음 현황 · 댓글) · 글쓰기(대상 회사 · 필독 · 상단고정 · 예약 · 일정 연결 · 첨부)
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, q, sb } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { dt } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox, Pill, FileDrop, Seg } from '../../lib/ui';
import { KIND, myPosts, myReads, spaceDownload, spaceUpload, kb } from '../../lib/space';

const linkify = (t: string) => t.split(/(https?:\/\/[^\s]+)/g).map((x, i) => (/^https?:\/\//.test(x) ? <a key={i} href={x} target="_blank" rel="noreferrer">{x}</a> : x));
const forCompany = (p: any, co: string) => co === 'all' || !(p.target_companies || []).length || p.target_companies.includes(co);

export function BoardList() {
  const { company, companies, profile, isAdmin, canEdit } = useAuth();
  const [kind, setKind] = useState<'all' | 'notice' | 'memo'>('all');
  const [unread, setUnread] = useState(false);
  const [find, setFind] = useState('');
  const data = useLoad(async () => {
    const [posts, reads, dir, cmts] = await Promise.all([
      q<any[]>(myPosts(false).limit(500)), myReads(),
      q<any[]>(sb.from('v_directory').select('id, company_id')),
      q<any[]>(sb.from('post_comments').select('post_id')),
    ]);
    const allReads = canEdit ? await q<any[]>(sb.from('post_reads').select('post_id, user_id, confirmed_at')) : [];
    return { posts, reads: new Map(reads.map((r) => [r.post_id, r])), dir, cmts, allReads };
  }, []);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorBox msg={data.error.includes('posts') ? '게시판 표가 아직 없습니다. 서버에서 bash scripts/update.sh 를 실행해 주세요.' : data.error} />;
  const d = data.data!;
  const now = new Date().toISOString();
  const coName = (id: string) => companies.find((c) => c.id === id)?.name || '';
  const targets = (p: any) => d.dir.filter((u) => u.id !== p.author_id && (!(p.target_companies || []).length || p.target_companies.includes(u.company_id))).length;
  const list = d.posts.filter((p) => (kind === 'all' || p.kind === kind) && forCompany(p, company) && (!unread || !d.reads.get(p.id))
    && (!find || (p.title + p.body).includes(find)));
  const cc = (id: string) => d.cmts.filter((c) => c.post_id === id).length;
  return (
    <>
      <div className="row between"><h1>게시판</h1>{canEdit && <Link className="btn pri" to="/space/board/new">글쓰기</Link>}</div>
      <div className="row between">
        <Seg label="분류" value={kind} onChange={setKind} items={[['all', '전체'], ['notice', '공지사항'], ['memo', '전달사항']]} />
        <div className="row">
          <label className="row" style={{ gap: 6, minHeight: 44 }}><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} style={{ width: 20, height: 20 }} /> 안 읽은 글만</label>
          <input className="input" style={{ width: 200 }} placeholder="제목 · 내용 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="글 찾기" />
        </div>
      </div>
      <section className="card flat">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th style={{ width: 90 }}>분류</th><th>제목</th><th>대상</th><th>작성</th><th>게시</th>{canEdit && <th className="r">필독 확인</th>}</tr></thead>
          <tbody>
            {list.map((p) => {
              const r = d.reads.get(p.id); const future = p.publish_at > now;
              const conf = d.allReads.filter((x) => x.post_id === p.id && x.confirmed_at).length; const tot = targets(p);
              const mine = p.author_id === profile?.id || isAdmin;
              return (
                <tr key={p.id} style={{ background: p.pinned ? 'var(--blue-ll)' : undefined }}>
                  <td><Pill c={p.kind === 'notice' ? 'blue' : ''}>{KIND[p.kind]}</Pill></td>
                  <td>
                    <Link to={`/space/board/${p.id}`} style={{ fontWeight: r ? 400 : 700, color: 'var(--text)', textDecoration: 'none' }}>
                      {p.pinned && '📌 '}{p.must_read && <Pill c="red">필독</Pill>} {p.title}</Link>
                    {cc(p.id) > 0 && <span className="muted"> [{cc(p.id)}]</span>}
                    {!r && !future && <span className="pill orange" style={{ marginLeft: 6 }}>새 글</span>}
                    {p.must_read && r && !r.confirmed_at && <span className="pill red" style={{ marginLeft: 6 }}>확인 필요</span>}
                    {p.attachments?.length > 0 && <span className="muted"> 📎{p.attachments.length}</span>}
                  </td>
                  <td className="muted">{(p.target_companies || []).length ? p.target_companies.map(coName).join(', ') : '전체'}</td>
                  <td>{p.profiles?.name || p.profiles?.username}</td>
                  <td className="num">{future ? <Pill c="orange">예약 {dt(p.publish_at)}</Pill> : dt(p.publish_at)}</td>
                  {canEdit && <td className="r num">{p.must_read && mine ? `${conf}/${tot} (${tot ? Math.round((conf / tot) * 100) : 0}%)` : ''}</td>}
                </tr>);
            })}
            {!list.length && <tr><td colSpan={6} className="sub">글이 없습니다.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

export function PostView() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { profile, isAdmin, companies } = useAuth();
  const data = useLoad(async () => {
    const p = await q<any>(sb.from('posts').select('*, profiles:author_id(name, username)').eq('id', id).single());
    const [cm, mine] = await Promise.all([
      q<any[]>(sb.from('post_comments').select('*, profiles:author_id(name, username)').eq('post_id', id).order('created_at')),
      q<any>(sb.from('post_reads').select('*').eq('post_id', id).eq('user_id', profile!.id).maybeSingle()),
    ]);
    return { p, cm, mine };
  }, [id]);
  const [text, setText] = useState('');
  const d = data.data;
  // 열면 읽음 표시
  useEffect(() => { if (d && !d.mine && d.p.publish_at <= new Date().toISOString()) sb.from('post_reads').insert({ post_id: id, user_id: profile!.id }).then(() => {}); }, [d?.p?.id]);
  if (data.loading && !d) return <Loading />;
  if (data.error || !d) return <ErrorBox msg={data.error || '글을 찾을 수 없습니다'} />;
  const p = d.p; const mine = p.author_id === profile?.id || isAdmin;
  const confirmRead = async () => {
    try { await q(sb.from('post_reads').upsert({ post_id: id, user_id: profile!.id, confirmed_at: new Date().toISOString() })); toast('확인했습니다'); data.reload(); } catch (e: any) { toast(e.message); }
  };
  const addComment = async () => {
    if (!text.trim()) return;
    try { await q(sb.from('post_comments').insert({ post_id: id, author_id: profile!.id, body: text.trim() })); setText(''); data.reload(); } catch (e: any) { toast(e.message); }
  };
  const del = async () => {
    if (!confirm('이 글을 지울까요? 첨부파일도 지워집니다.')) return;
    try {
      const paths = (p.attachments || []).map((a: any) => a.path);
      if (paths.length) await sb.storage.from('space-files').remove(paths);
      await q(sb.from('posts').delete().eq('id', id)); nav('/space/board');
    } catch (e: any) { toast(e.message); }
  };
  const coName = (cid: string) => companies.find((c) => c.id === cid)?.name || '';
  return (
    <>
      <nav className="crumb"><Link to="/space">공용공간</Link> › <Link to="/space/board">게시판</Link></nav>
      <section className="card">
        <div className="row" style={{ gap: 6 }}>
          <Pill c={p.kind === 'notice' ? 'blue' : ''}>{KIND[p.kind]}</Pill>{p.must_read && <Pill c="red">필독</Pill>}{p.pinned && <Pill>📌 상단고정</Pill>}
          <span className="muted">대상: {(p.target_companies || []).length ? p.target_companies.map(coName).join(', ') : '전체 회사'}</span>
        </div>
        <h1 style={{ fontSize: 22 }}>{p.title}</h1>
        <div className="muted">{p.profiles?.name || p.profiles?.username} · {dt(p.publish_at)}{p.publish_at > new Date().toISOString() ? ' 게시 예약' : ''}{p.event_date ? ` · 일정 ${p.event_date}${p.event_end ? ' ~ ' + p.event_end : ''}` : ''}</div>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.7, borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>{linkify(p.body)}</div>
        {!!p.attachments?.length && <div className="row">{p.attachments.map((a: any) => <button key={a.path} className="btn sm" onClick={() => spaceDownload(a.path, a.name).catch((e) => toast(e.message))}>📎 {a.name} <span className="muted">{kb(a.size)}</span></button>)}</div>}
        {p.must_read && (d.mine?.confirmed_at
          ? <div className="banner teal"><span>✔ {dt(d.mine.confirmed_at)}에 확인했습니다.</span></div>
          : <button className="btn pri" style={{ alignSelf: 'flex-start', minWidth: 200 }} onClick={confirmRead}>확인했습니다</button>)}
        {mine && <div className="row"><Link className="btn sm" to={`/space/board/${id}/edit`}>고치기</Link><button className="btn sm" onClick={del}>지우기</button></div>}
      </section>
      {mine && <ReadStatus p={p} />}
      <section className="card">
        <h2>댓글 {d.cm.length}</h2>
        {d.cm.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
            <div className="row between"><b>{c.profiles?.name || c.profiles?.username}</b><span className="muted">{dt(c.created_at)}{(c.author_id === profile?.id || isAdmin) && <button className="link" style={{ border: 0, background: 'none', cursor: 'pointer', marginLeft: 8 }} onClick={() => q(sb.from('post_comments').delete().eq('id', c.id)).then(data.reload)}>지우기</button>}</span></div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{linkify(c.body)}</div>
          </div>))}
        {p.allow_comments ? <div className="row"><textarea className="input" rows={2} style={{ flex: 1 }} placeholder="댓글" value={text} onChange={(e) => setText(e.target.value)} aria-label="댓글" /><button className="btn pri" onClick={addComment} disabled={!text.trim()}>등록</button></div>
          : <span className="muted">댓글을 받지 않는 글입니다.</span>}
      </section>
    </>
  );
}

function ReadStatus({ p }: { p: any }) {
  const toast = useToast();
  const { companies } = useAuth();
  const data = useLoad(async () => {
    const [dir, reads] = await Promise.all([q<any[]>(sb.from('v_directory').select('id, name, company_id, dept')), q<any[]>(sb.from('post_reads').select('*').eq('post_id', p.id))]);
    return { dir, reads: new Map(reads.map((r) => [r.user_id, r])) };
  }, [p.id]);
  const [open, setOpen] = useState(false);
  if (!data.data) return null;
  const people = data.data.dir.filter((u) => u.id !== p.author_id && (!(p.target_companies || []).length || p.target_companies.includes(u.company_id)));
  const stat = (u: any) => { const r = data.data!.reads.get(u.id); return r?.confirmed_at ? 'ok' : r ? 'read' : 'no'; };
  const done = people.filter((u) => (p.must_read ? stat(u) === 'ok' : stat(u) !== 'no')).length;
  const remind = async () => { try { const r = await api('/api/space/remind', { post_id: p.id }); toast(`${r.sent}명에게 다시 알렸습니다`); } catch (e: any) { toast(e.message); } };
  const byCo = companies.map((c) => ({ c, us: people.filter((u) => u.company_id === c.id) })).filter((x) => x.us.length);
  return (
    <section className="card">
      <div className="card-h"><h2>{p.must_read ? '필독 확인' : '읽음'} 현황 {done}/{people.length}명</h2>
        <div className="row"><button className="btn sm" onClick={() => setOpen(!open)}>{open ? '접기' : '사람별 보기'}</button>{done < people.length && <button className="btn sm pri" onClick={remind}>안 한 사람에게 다시 알림</button>}</div></div>
      <div className="row">{byCo.map(({ c, us }) => { const n = us.filter((u) => (p.must_read ? stat(u) === 'ok' : stat(u) !== 'no')).length; return <Pill key={c.id} c={n === us.length ? 'green' : 'orange'}>{c.name} {n}/{us.length}</Pill>; })}</div>
      {open && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>회사</th><th>이름</th><th>부서</th><th>상태</th></tr></thead><tbody>
        {people.map((u) => { const s = stat(u); const r = data.data!.reads.get(u.id); return (
          <tr key={u.id}><td>{companies.find((c) => c.id === u.company_id)?.name}</td><td>{u.name}</td><td className="sub">{u.dept}</td>
            <td>{s === 'ok' ? <Pill c="green">확인 {dt(r.confirmed_at)}</Pill> : s === 'read' ? <Pill c="blue">읽음{p.must_read ? ' · 확인 전' : ''}</Pill> : <Pill c="red">안 읽음</Pill>}</td></tr>); })}
      </tbody></table></div>}
    </section>
  );
}

const localDT = (iso?: string) => { const d = iso ? new Date(iso) : new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export function PostEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { companies, profile } = useAuth();
  const existing = useLoad(() => (id ? q<any>(sb.from('posts').select('*').eq('id', id).single()) : Promise.resolve(null)), [id]);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const init = useMemo(() => existing.data || { kind: 'notice', title: '', body: '', target_companies: [], must_read: false, pinned: false, allow_comments: true, attachments: [], event_date: null, event_end: null, publish_at: null }, [existing.data]);
  const v = f || { ...init, schedule: !!(init.publish_at && init.publish_at > new Date().toISOString()), at: localDT(init.publish_at || undefined) };
  const set = (x: any) => setF({ ...v, ...x });
  if (existing.loading) return <Loading />;
  const toggleCo = (cid: string) => set({ target_companies: v.target_companies.includes(cid) ? v.target_companies.filter((x: string) => x !== cid) : [...v.target_companies, cid] });
  const attach = async (files: File[]) => {
    setBusy('첨부 올리는 중…');
    try { const up: any[] = []; for (const fl of files) { if (fl.size > 200 * 1024 * 1024) { toast(fl.name + ': 200MB 넘는 파일은 자료실에 올려 주세요'); continue; } up.push(await spaceUpload('board', fl)); } set({ attachments: [...v.attachments, ...up] }); }
    catch (e: any) { toast(e.message); }
    setBusy('');
  };
  const save = async () => {
    if (!v.title.trim()) return toast('제목을 넣어 주세요');
    setBusy('저장 중…');
    const row = { kind: v.kind, title: v.title.trim(), body: v.body, target_companies: v.target_companies, must_read: v.must_read, pinned: v.pinned, allow_comments: v.allow_comments,
      attachments: v.attachments, event_date: v.event_date || null, event_end: v.event_date && v.event_end ? v.event_end : null,
      publish_at: v.schedule ? new Date(v.at).toISOString() : (existing.data?.publish_at && existing.data.publish_at <= new Date().toISOString() ? existing.data.publish_at : new Date().toISOString()),
      updated_at: new Date().toISOString() };
    try {
      const saved = id ? await q<any>(sb.from('posts').update(row).eq('id', id).select().single()) : await q<any>(sb.from('posts').insert({ ...row, author_id: profile!.id }).select().single());
      if (saved.publish_at <= new Date().toISOString()) await api('/api/space/publish', { post_id: saved.id }).catch(() => {});
      toast(v.schedule ? `${dt(saved.publish_at)}에 게시되도록 예약했습니다` : '올렸습니다'); nav(`/space/board/${saved.id}`);
    } catch (e: any) { toast(e.message); setBusy(''); }
  };
  return (
    <>
      <nav className="crumb"><Link to="/space/board">게시판</Link> › {id ? '고치기' : '글쓰기'}</nav>
      <div className="g2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        <section className="card">
          <Seg label="분류" value={v.kind} onChange={(k) => set({ kind: k })} items={[['notice', '공지사항'], ['memo', '전달사항']]} />
          <div className="field"><label htmlFor="pt">제목</label><input id="pt" className="input" value={v.title} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="field"><label htmlFor="pb">내용</label><textarea id="pb" className="input" rows={16} value={v.body} onChange={(e) => set({ body: e.target.value })} placeholder="링크(https://…)는 누를 수 있게 바뀝니다" /></div>
          <FileDrop multiple label={busy || '첨부파일을 끌어다 놓거나 눌러서 고르세요'} onFiles={attach} />
          {v.attachments.map((a: any, i: number) => <div key={a.path} className="row between"><span>📎 {a.name} <span className="muted">{kb(a.size)}</span></span><button className="btn sm" onClick={() => set({ attachments: v.attachments.filter((_: any, k: number) => k !== i) })}>빼기</button></div>)}
        </section>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="card">
            <b>대상 회사 <span className="muted">아무것도 안 고르면 전체</span></b>
            {companies.map((c) => <label key={c.id} className="row" style={{ gap: 8, minHeight: 40 }}><input type="checkbox" checked={v.target_companies.includes(c.id)} onChange={() => toggleCo(c.id)} style={{ width: 20, height: 20 }} />{c.name}</label>)}
          </section>
          <section className="card">
            {([['must_read', '필독 (읽고 \'확인했습니다\' 받기)'], ['pinned', '상단고정'], ['allow_comments', '댓글 받기']] as const).map(([k, l]) =>
              <label key={k} className="row" style={{ gap: 8, minHeight: 40 }}><input type="checkbox" checked={!!v[k]} onChange={(e) => set({ [k]: e.target.checked })} style={{ width: 20, height: 20 }} />{l}</label>)}
          </section>
          <section className="card">
            <b>게시</b>
            <label className="row" style={{ gap: 8, minHeight: 40 }}><input type="radio" checked={!v.schedule} onChange={() => set({ schedule: false })} style={{ width: 20, height: 20 }} />지금 올리기</label>
            <label className="row" style={{ gap: 8, minHeight: 40 }}><input type="radio" checked={v.schedule} onChange={() => set({ schedule: true })} style={{ width: 20, height: 20 }} />예약</label>
            {v.schedule && <input className="input" type="datetime-local" value={v.at} onChange={(e) => set({ at: e.target.value })} aria-label="예약 시각" />}
            <div className="muted">올리면 대상 회사 직원에게 알림이 갑니다 (예약이면 그 시각에).</div>
          </section>
          <section className="card">
            <b>회사 일정에 올리기 <span className="muted">(선택)</span></b>
            <div className="row"><input className="input" type="date" style={{ width: 150 }} value={v.event_date || ''} onChange={(e) => set({ event_date: e.target.value || null })} aria-label="일정 시작일" />
              ~ <input className="input" type="date" style={{ width: 150 }} value={v.event_end || ''} onChange={(e) => set({ event_end: e.target.value || null })} disabled={!v.event_date} aria-label="일정 종료일" /></div>
            <div className="muted">교육 · 점검처럼 날짜가 있는 공지는 일정에도 같이 보입니다.</div>
          </section>
          <button className="btn pri" style={{ minHeight: 48 }} disabled={!!busy} onClick={save}>{busy || (id ? '저장' : v.schedule ? '예약하기' : '올리기')}</button>
        </aside>
      </div>
    </>
  );
}
