import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { sb, q, api } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { won, today } from '../../lib/format';
import { logAction } from '../../lib/data';
import { useToast, Loading, ErrorBox, Modal, Pill, Empty } from '../../lib/ui';
import { Product, Delivery, Stat, UNITS, CATEGORIES, short, daysLeft, loadStats, addProductPhoto, spaceUrls } from '../../lib/products';
import { SPACE } from '../../lib/space';

/* ---------- 공통: 데이터 · 머리 ---------- */
function useProductData() {
  const { company } = useAuth();
  const [d, setD] = useState<{ products: Product[]; deliveries: Delivery[]; stats: Record<string, Stat> } | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    try {
      let pq = sb.from('products').select('*, product_photos(id, storage_path, thumb_path, sort)').order('name');
      let dq = sb.from('deliveries').select('*, products(name, spec, unit)').order('delivered_on', { ascending: false }).order('created_at', { ascending: false });
      if (company !== 'all') { pq = pq.eq('company_id', company); dq = dq.eq('company_id', company); }
      const [products, deliveries, stats] = await Promise.all([q<Product[]>(pq), q<Delivery[]>(dq), loadStats()]);
      products.forEach((p) => p.product_photos?.sort((a, b) => a.sort - b.sort));
      setD({ products, deliveries, stats });
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [company]);
  return { d, err, reload: load };
}
const KindPill = ({ k }: { k: string }) => <Pill c={k === '관급' ? 'blue' : 'orange'}>{k}</Pill>;

function Head({ title, right }: { title: string; right?: React.ReactNode }) {
  const { company, companies } = useAuth();
  const co = companies.find((c) => c.id === company)?.name;
  return (<>
    <div className="row between"><div><h1>{title}</h1><p className="sub" style={{ margin: '4px 0 0' }}>{co ? co : '전체 회사'} · 관급자재 · 사급자재 통합 관리 (위쪽 회사 선택을 따릅니다)</p></div><div className="row">{right}</div></div>
    <nav className="tabs" aria-label="제품 · 실적">
      <NavLink to="/products" end className={({ isActive }) => (isActive ? 'on' : '')}>실적 한눈에</NavLink>
      <NavLink to="/products/list" className={({ isActive }) => (isActive ? 'on' : '')}>제품 목록</NavLink>
      <NavLink to="/products/deliveries" className={({ isActive }) => (isActive ? 'on' : '')}>납품이력</NavLink>
    </nav>
  </>);
}
function canWrite(profile: any, coId?: string) {
  if (!profile) return false;
  if (profile.role === 'system_admin') return true;
  return ['company_admin', 'staff'].includes(profile.role) && (!coId || profile.company_id === coId);
}

/* =====================================================================
   PD-01 실적 한눈에
   ===================================================================== */
export function ProductDashboard() {
  const { profile } = useAuth();
  const { d, err, reload } = useProductData();
  const [year, setYear] = useState(new Date().getFullYear());
  const [newD, setNewD] = useState(false);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <><Head title="제품 · 실적" /><Loading /></>;
  const years = [...new Set([new Date().getFullYear(), ...d.deliveries.map((x) => +x.delivered_on.slice(0, 4))])].sort((a, b) => b - a);
  const yd = d.deliveries.filter((x) => x.delivered_on.startsWith(String(year)));
  const prev = d.deliveries.filter((x) => x.delivered_on.startsWith(String(year - 1)));
  const sum = (a: Delivery[]) => a.reduce((s, x) => s + Number(x.amount), 0);
  const tot = sum(yd), gov = sum(yd.filter((x) => x.kind === '관급')), pvt = tot - gov, ptot = sum(prev);
  const growth = ptot > 0 ? ((tot - ptot) / ptot) * 100 : null;
  const pg = d.products.filter((p) => p.kind === '관급').length;
  const months = Array.from({ length: 12 }, (_, i) => { const m = yd.filter((x) => +x.delivered_on.slice(5, 7) === i + 1); return { g: sum(m.filter((x) => x.kind === '관급')), p: sum(m.filter((x) => x.kind !== '관급')) }; });
  const maxM = Math.max(1, ...months.map((m) => m.g + m.p));
  const group = (key: (x: Delivery) => string) => { const m = new Map<string, { n: number; a: number }>(); yd.forEach((x) => { const k = key(x) || '(미입력)'; const v = m.get(k) || { n: 0, a: 0 }; v.n++; v.a += Number(x.amount); m.set(k, v); }); return [...m.entries()].sort((a, b) => b[1].a - a[1].a).slice(0, 10); };
  const topP = group((x) => x.product_id);
  const topC = group((x) => x.client || '');
  const pName = (id: string) => d.products.find((p) => p.id === id);
  const soon = d.products.filter((p) => p.kind === '관급' && p.active && p.contract_end).map((p) => ({ p, days: daysLeft(p.contract_end)! })).filter((x) => x.days <= 60).sort((a, b) => a.days - b.days);

  return (<>
    <Head title="제품 · 실적" right={canWrite(profile) && <button className="btn pri" onClick={() => setNewD(true)}>＋ 납품 입력</button>} />
    {soon.length > 0 && <div className="banner"><b>조달 계약 만료 임박 {soon.length}건</b>
      <span>{soon.slice(0, 4).map((x) => <Link key={x.p.id} to={'/products/' + x.p.id} style={{ marginRight: 10 }}>{x.p.name} ({x.days < 0 ? `${-x.days}일 지남` : `D-${x.days}`})</Link>)}{soon.length > 4 && `외 ${soon.length - 4}건`}</span></div>}
    <div className="row"><h2 style={{ marginRight: 'auto' }}>{year}년 납품실적</h2>
      <select className="input" style={{ width: 120 }} aria-label="연도" value={year} onChange={(e) => setYear(+e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}년</option>)}</select></div>
    <div className="grid g4">
      <div className="stat"><span className="l">총 납품액</span><span className="v">{short(tot)}</span><span className="s">{won(tot)}원{growth !== null && ` · 전년 대비 ${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}</span></div>
      <div className="stat"><span className="l"><KindPill k="관급" /></span><span className="v">{short(gov)}</span><span className="s">{tot ? Math.round((gov / tot) * 100) : 0}% · {yd.filter((x) => x.kind === '관급').length}건</span></div>
      <div className="stat"><span className="l"><KindPill k="사급" /></span><span className="v">{short(pvt)}</span><span className="s">{tot ? Math.round((pvt / tot) * 100) : 0}% · {yd.filter((x) => x.kind !== '관급').length}건</span></div>
      <div className="stat"><span className="l">등록 제품</span><span className="v">{d.products.length}</span><span className="s">관급 {pg} · 사급 {d.products.length - pg} · 누적 {short(sum(d.deliveries))}원</span></div>
    </div>
    {tot > 0 && <div className="splitbar" title={`관급 ${Math.round((gov / tot) * 100)}%`}><i style={{ width: (gov / tot) * 100 + '%' }} /></div>}
    <div className="grid g2">
      <section className="card">
        <div className="card-h"><h2>월별 납품액</h2><span className="row muted"><span className="lg gov" />관급 <span className="lg pvt" />사급</span></div>
        <div className="mchart" role="img" aria-label={`${year}년 월별 납품액`}>
          {months.map((m, i) => (
            <div key={i} className="mcol" title={`${i + 1}월 관급 ${won(m.g)} · 사급 ${won(m.p)}`}>
              <span className="v">{m.g + m.p ? short(m.g + m.p) : ''}</span>
              <div className="bars"><i className="pvt" style={{ height: (m.p / maxM) * 100 + '%' }} /><i className="gov" style={{ height: (m.g / maxM) * 100 + '%' }} /></div>
              <span className="m">{i + 1}월</span>
            </div>))}
        </div>
      </section>
      <section className="card">
        <h2>제품 순위 (납품액)</h2>
        {!topP.length ? <Empty>{year}년 납품 기록이 없습니다.</Empty> : <table className="tbl"><tbody>{topP.map(([id, v], i) => { const p = pName(id); return (
          <tr key={id}><td className="num" style={{ width: 28 }}>{i + 1}</td><td><Link to={'/products/' + id}>{p?.name || '(삭제된 제품)'}</Link> <span className="muted">{p?.spec}</span></td><td className="r">{v.n}건</td><td className="r"><b>{won(v.a)}</b></td></tr>); })}</tbody></table>}
      </section>
      <section className="card">
        <h2>수요기관 · 발주처별</h2>
        {!topC.length ? <Empty>기록이 없습니다.</Empty> : <table className="tbl"><tbody>{topC.map(([k, v]) => <tr key={k}><td>{k}</td><td className="r">{v.n}건</td><td className="r"><b>{won(v.a)}</b></td><td style={{ width: 120 }}><span className="bar"><i style={{ width: (v.a / (topC[0][1].a || 1)) * 100 + '%' }} /></span></td></tr>)}</tbody></table>}
      </section>
      <section className="card">
        <div className="card-h"><h2>최근 납품</h2><Link to="/products/deliveries" className="btn sm">전체 보기</Link></div>
        {!d.deliveries.length ? <Empty>아직 납품 기록이 없습니다.</Empty> : <DeliveryList compact rows={d.deliveries.slice(0, 8)} />}
      </section>
    </div>
    {newD && <DeliveryEdit products={d.products} onClose={() => setNewD(false)} onSaved={() => { setNewD(false); reload(); }} />}
  </>);
}

/* =====================================================================
   PD-02 제품 목록
   ===================================================================== */
export function ProductList() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const { d, err, reload } = useProductData();
  const [kind, setKind] = useState<'all' | '관급' | '사급'>('all');
  const [qs, setQs] = useState('');
  const [sort, setSort] = useState<'amount' | 'name' | 'new'>('amount');
  const [stop, setStop] = useState(false);
  const [edit, setEdit] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const list = useMemo(() => {
    if (!d) return [];
    const w = qs.trim().toLowerCase();
    let ps = d.products.filter((p) => (kind === 'all' || p.kind === kind) && (stop || p.active) && (!w || [p.name, p.spec, p.g2b_no, p.category, p.maker].some((x) => (x || '').toLowerCase().includes(w))));
    ps = [...ps].sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'new' ? (a, b) => b.created_at.localeCompare(a.created_at) : (a, b) => (d.stats[b.id]?.amount || 0) - (d.stats[a.id]?.amount || 0));
    return ps;
  }, [d, kind, qs, sort, stop]);
  const covers = list.map((p) => p.product_photos?.[0]).filter(Boolean).map((x) => x!.thumb_path || x!.storage_path);
  useEffect(() => { if (covers.length) spaceUrls(covers).then(setUrls); }, [covers.join('|')]);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <><Head title="제품 목록" /><Loading /></>;
  const n = (k: string) => d.products.filter((p) => (k === 'all' || p.kind === k) && (stop || p.active)).length;
  return (<>
    <Head title="제품 목록" right={canWrite(profile) && <button className="btn pri" onClick={() => setEdit(true)}>＋ 제품 등록</button>} />
    <div className="row">
      <div className="seg" role="group" aria-label="구분">{([['all', '전체'], ['관급', '관급'], ['사급', '사급']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l} {n(k)}</button>)}</div>
      <input className="input" type="search" style={{ flex: '1 1 240px' }} placeholder="제품명 · 규격 · 물품식별번호 · 제조사 검색" value={qs} onChange={(e) => setQs(e.target.value)} aria-label="검색" />
      <select className="input" style={{ width: 140 }} aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="amount">납품액순</option><option value="name">이름순</option><option value="new">최근 등록순</option></select>
      <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} /> 판매 중단 포함</label>
    </div>
    {!list.length ? <Empty>{d.products.length ? '조건에 맞는 제품이 없습니다.' : '등록된 제품이 없습니다. [＋ 제품 등록]으로 시작하세요.'}</Empty> :
      <div className="pdcards">{list.map((p) => { const s = d.stats[p.id]; const ph = p.product_photos?.[0]; const dl = daysLeft(p.contract_end); return (
        <Link key={p.id} to={'/products/' + p.id} className={'pdcard' + (p.active ? '' : ' off')}>
          <div className="ph">{ph && urls[ph.thumb_path || ph.storage_path] ? <img src={urls[ph.thumb_path || ph.storage_path]} alt="" loading="lazy" /> : <span>{p.name.slice(0, 2)}</span>}{(p.product_photos?.length || 0) > 1 && <span className="cnt">사진 {p.product_photos!.length}</span>}</div>
          <div className="bd">
            <div className="row" style={{ gap: 4 }}><KindPill k={p.kind} />{p.category && <Pill>{p.category}</Pill>}{!p.active && <Pill c="red">판매 중단</Pill>}{p.kind === '관급' && dl !== null && dl <= 60 && <Pill c="red">{dl < 0 ? '계약 만료' : `만료 D-${dl}`}</Pill>}</div>
            <b className="nm">{p.name}</b>{p.spec && <span className="muted">{p.spec}</span>}
            <span><b className="num">{won(p.price)}</b><span className="muted">원 / {p.unit}</span></span>
            <span className="ft"><span>납품 {s?.n || 0}건</span><span className="num">{short(s?.amount || 0)}원</span></span>
          </div>
        </Link>); })}</div>}
    {edit && <ProductEdit onClose={() => setEdit(false)} onSaved={(id) => { setEdit(false); reload(); nav('/products/' + id); }} />}
  </>);
}

/* =====================================================================
   PD-03 제품 상세
   ===================================================================== */
export function ProductDetail() {
  const { id = '' } = useParams();
  const { profile, companies } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [p, setP] = useState<Product | null>(null);
  const [ds, setDs] = useState<Delivery[]>([]);
  const [all, setAll] = useState<Product[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [dEdit, setDEdit] = useState<Delivery | 'new' | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = async () => {
    try {
      const [pp, dd, aa] = await Promise.all([
        q<Product>(sb.from('products').select('*, product_photos(id, storage_path, thumb_path, sort)').eq('id', id).single()),
        q<Delivery[]>(sb.from('deliveries').select('*, products(name, spec, unit)').eq('product_id', id).order('delivered_on', { ascending: false })),
        q<Product[]>(sb.from('products').select('*').order('name')),
      ]);
      pp.product_photos?.sort((a, b) => a.sort - b.sort);
      setP(pp); setDs(dd); setAll(aa);
      const paths = (pp.product_photos || []).flatMap((x) => [x.storage_path, x.thumb_path || '']).filter(Boolean);
      if (paths.length) setUrls(await spaceUrls(paths));
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [id]);
  if (err) return <ErrorBox msg={err} />;
  if (!p) return <Loading />;
  const w = canWrite(profile, p.company_id);
  const tot = ds.reduce((s, x) => s + Number(x.amount), 0), qy = ds.reduce((s, x) => s + Number(x.qty), 0);
  const dl = daysLeft(p.contract_end);
  const photos = p.product_photos || [];

  const addPhotos = async (fs: File[]) => {
    setBusy(true);
    try { let i = photos.length; for (const f of fs.filter((x) => x.type.startsWith('image/'))) await addProductPhoto(p.id, f, i++); toast('사진을 올렸습니다'); load(); }
    catch (e: any) { toast('사진 올리기 실패: ' + e.message); }
    setBusy(false);
  };
  const delPhoto = async (ph: { id: string; storage_path: string; thumb_path: string | null }) => {
    if (!confirm('이 사진을 지울까요?')) return;
    await q(sb.from('product_photos').delete().eq('id', ph.id));
    await sb.storage.from(SPACE).remove([ph.storage_path, ph.thumb_path].filter(Boolean) as string[]);
    load();
  };
  const firstPhoto = async (ph: { id: string }) => {
    const order = [ph, ...photos.filter((x) => x.id !== ph.id)];
    await Promise.all(order.map((x, i) => q(sb.from('product_photos').update({ sort: i }).eq('id', x.id))));
    load();
  };
  const remove = async () => {
    if (ds.length) {
      if (!confirm(`납품이력이 ${ds.length}건 있어 지울 수 없습니다. 대신 '판매 중단'으로 바꿀까요? (이력 · 실적은 그대로 남습니다)`)) return;
      await q(sb.from('products').update({ active: false }).eq('id', p.id)); toast('판매 중단으로 바꿨습니다'); return load();
    }
    if (!confirm(`'${p.name}'을(를) 지울까요?`)) return;
    try {
      await sb.storage.from(SPACE).remove(photos.flatMap((x) => [x.storage_path, x.thumb_path].filter(Boolean) as string[]));
      await q(sb.from('products').delete().eq('id', p.id)); await logAction(null, '제품 삭제', p.name); nav('/products/list');
    } catch (e: any) { toast(e.message); }
  };
  const fact = (k: string, v: React.ReactNode) => v ? <div className="fact"><span className="k">{k}</span><span className="v">{v}</span></div> : null;

  return (<>
    <div className="row"><Link to="/products/list" className="btn sm">‹ 제품 목록</Link></div>
    <div className="row between">
      <div>
        <div className="row" style={{ gap: 4 }}><KindPill k={p.kind} /><Pill>{companies.find((c) => c.id === p.company_id)?.name}</Pill>{p.category && <Pill>{p.category}</Pill>}{!p.active && <Pill c="red">판매 중단</Pill>}</div>
        <h1 style={{ marginTop: 6 }}>{p.name}</h1>{p.spec && <p className="sub" style={{ margin: '4px 0 0' }}>{p.spec}</p>}
      </div>
      {w && <div className="row"><button className="btn" onClick={() => setEdit(true)}>정보 고치기</button>{!p.active && <button className="btn" onClick={async () => { await q(sb.from('products').update({ active: true }).eq('id', p.id)); load(); }}>판매 다시 시작</button>}<button className="btn danger" onClick={remove}>{ds.length ? '판매 중단' : '지우기'}</button></div>}
    </div>
    <div className="grid g2">
      <section className="card">
        <h2>기본 정보</h2>
        <div className="facts">
          {fact('단가', <><b className="num">{won(p.price)}</b>원 / {p.unit}</>)}
          {fact('납품 누계', <><span className="num">{ds.length}</span>건 · <b className="num">{won(tot)}</b>원</>)}
          {fact('누적 수량', <><span className="num">{qy.toLocaleString('ko-KR')}</span> {p.unit}</>)}
          {fact('제조사', p.maker)}
          {fact('물품식별번호', p.g2b_no)}
          {fact('조달 계약번호', p.contract_no)}
          {fact('계약 기간', (p.contract_start || p.contract_end) && <>{p.contract_start || '?'} ~ {p.contract_end || '?'} {dl !== null && dl <= 60 && <Pill c="red">{dl < 0 ? `${-dl}일 지남` : `D-${dl}`}</Pill>}</>)}
          {fact('비고', p.note && <span style={{ whiteSpace: 'pre-wrap' }}>{p.note}</span>)}
        </div>
        {p.g2b_url && <a className="btn" href={p.g2b_url} target="_blank" rel="noreferrer">조달청 페이지 열기 ↗</a>}
      </section>
      <section className="card">
        <div className="card-h"><h2>사진 {photos.length}</h2>{w && <><button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? '올리는 중…' : '＋ 사진 올리기'}</button><input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} /></>}</div>
        {!photos.length ? <Empty>사진이 없습니다. 제품 사진 · 시공 사진을 올려 두면 목록에서 보입니다.</Empty> :
          <div className="photo-grid">{photos.map((ph, i) => (
            <div key={ph.id} className="pdph">
              <button className="photo" onClick={() => setBig(ph.storage_path)} aria-label={`사진 ${i + 1} 크게 보기`}>{urls[ph.thumb_path || ph.storage_path] && <img src={urls[ph.thumb_path || ph.storage_path]} alt="" />}{i === 0 && <span className="tag pill navy">대표</span>}</button>
              {w && <div className="row" style={{ gap: 4 }}>{i > 0 && <button className="btn sm" onClick={() => firstPhoto(ph)}>대표로</button>}<button className="btn sm danger" onClick={() => delPhoto(ph)}>지우기</button></div>}
            </div>))}</div>}
      </section>
    </div>
    <section className="card">
      <div className="card-h"><h2>납품이력 {ds.length}건</h2>{w && <button className="btn pri sm" onClick={() => setDEdit('new')}>＋ 납품 입력</button>}</div>
      {!ds.length ? <Empty>아직 납품 기록이 없습니다.</Empty> : <DeliveryList rows={ds} hideProduct onEdit={w ? (x) => setDEdit(x) : undefined} />}
    </section>
    {edit && <ProductEdit p={p} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
    {dEdit && <DeliveryEdit products={all} fixed={p} d={dEdit === 'new' ? undefined : dEdit} onClose={() => setDEdit(null)} onSaved={() => { setDEdit(null); load(); }} />}
    {big && <div className="pview" role="dialog" aria-modal="true" aria-label="사진 크게 보기" onClick={() => setBig(null)}><div className="top"><button className="ib" aria-label="닫기">✕</button></div><div className="stage">{urls[big] && <img src={urls[big]} alt="" />}</div></div>}
  </>);
}

/* =====================================================================
   PD-04 납품이력
   ===================================================================== */
export function DeliveryPage() {
  const { profile, company } = useAuth();
  const toast = useToast();
  const { d, err, reload } = useProductData();
  const [kind, setKind] = useState<'all' | '관급' | '사급'>('all');
  const [year, setYear] = useState('all');
  const [qs, setQs] = useState('');
  const [edit, setEdit] = useState<Delivery | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <><Head title="납품이력" /><Loading /></>;
  const years = [...new Set(d.deliveries.map((x) => x.delivered_on.slice(0, 4)))].sort().reverse();
  const w = qs.trim().toLowerCase();
  const rows = d.deliveries.filter((x) => (kind === 'all' || x.kind === kind) && (year === 'all' || x.delivered_on.startsWith(year)) &&
    (!w || [x.products?.name, x.products?.spec, x.project_name, x.client, x.contractor, x.note].some((s) => (s || '').toLowerCase().includes(w))));
  const tot = rows.reduce((s, x) => s + Number(x.amount), 0), g = rows.filter((x) => x.kind === '관급').reduce((s, x) => s + Number(x.amount), 0);
  const excel = async () => {
    setBusy(true);
    try {
      const r = await api('/api/products/deliveries-xlsx', { company, kind, year, q: qs.trim(), ids: rows.map((x) => x.id) });
      const bin = atob(r.base64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = r.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e: any) { toast('엑셀 만들기 실패: ' + e.message); }
    setBusy(false);
  };
  return (<>
    <Head title="납품이력" right={<><button className="btn" disabled={busy || !rows.length} onClick={excel}>{busy ? '만드는 중…' : '엑셀로 받기'}</button>{canWrite(profile) && <button className="btn pri" onClick={() => setEdit('new')}>＋ 납품 입력</button>}</>} />
    <div className="row">
      <div className="seg" role="group" aria-label="구분">{([['all', '전체'], ['관급', '관급'], ['사급', '사급']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
      <select className="input" style={{ width: 130 }} aria-label="연도" value={year} onChange={(e) => setYear(e.target.value)}><option value="all">전체 연도</option>{years.map((y) => <option key={y} value={y}>{y}년</option>)}</select>
      <input className="input" type="search" style={{ flex: '1 1 240px' }} placeholder="제품 · 공사명 · 수요기관 · 시공사 검색" value={qs} onChange={(e) => setQs(e.target.value)} aria-label="검색" />
    </div>
    <section className="card">
      <div className="row" style={{ gap: 18 }}><span>건수 <b className="num">{rows.length}</b></span><span>합계 <b className="num">{won(tot)}</b>원</span><span><KindPill k="관급" /> <b className="num">{short(g)}</b></span><span><KindPill k="사급" /> <b className="num">{short(tot - g)}</b></span></div>
      {!rows.length ? <Empty>{d.deliveries.length ? '조건에 맞는 납품 기록이 없습니다.' : '아직 납품 기록이 없습니다.'}</Empty> : <DeliveryList rows={rows} onEdit={canWrite(profile) ? (x) => { if (canWrite(profile, x.company_id)) setEdit(x); else toast('다른 회사 납품 기록은 고칠 수 없습니다'); } : undefined} />}
    </section>
    {edit && <DeliveryEdit products={d.products} d={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
  </>);
}

/* ---------- 납품 목록 한 줄 ---------- */
function DeliveryList({ rows, hideProduct, onEdit, compact }: { rows: Delivery[]; hideProduct?: boolean; onEdit?: (d: Delivery) => void; compact?: boolean }) {
  if (compact) return (
    <table className="tbl"><tbody>{rows.map((x) => (
      <tr key={x.id}><td className="num muted" style={{ whiteSpace: 'nowrap' }}>{x.delivered_on.slice(5).replace('-', '.')}</td>
        <td><KindPill k={x.kind} /> <Link to={'/products/' + x.product_id}>{x.products?.name}</Link><div className="muted">{[x.project_name, x.client].filter(Boolean).join(' · ')}</div></td>
        <td className="r"><b>{won(x.amount)}</b></td></tr>))}</tbody></table>
  );
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>납품일</th><th>구분</th>{!hideProduct && <th>제품</th>}<th>공사명</th><th>수요기관</th><th className="r">수량</th><th className="r">단가</th><th className="r">금액</th>{onEdit && <th />}</tr></thead>
      <tbody>{rows.map((x) => (
        <tr key={x.id}>
          <td className="num" style={{ whiteSpace: 'nowrap' }}>{x.delivered_on}</td><td><KindPill k={x.kind} /></td>
          {!hideProduct && <td><Link to={'/products/' + x.product_id}>{x.products?.name || '(제품)'}</Link>{x.products?.spec && <div className="muted">{x.products.spec}</div>}</td>}
          <td>{x.project_id ? <Link to={'/projects/' + x.project_id}>{x.project_name}</Link> : x.project_name || <span className="muted">-</span>}{x.contractor && <div className="muted">{x.contractor}</div>}</td>
          <td>{x.client || '-'}</td>
          <td className="r">{Number(x.qty).toLocaleString('ko-KR')} {x.products?.unit}</td><td className="r">{won(x.price)}</td><td className="r"><b>{won(x.amount)}</b></td>
          {onEdit && <td><button className="btn sm" onClick={() => onEdit(x)}>고치기</button></td>}
        </tr>))}</tbody>
    </table></div>
  );
}

/* ---------- 제품 등록 · 고치기 ---------- */
function ProductEdit({ p, onClose, onSaved }: { p?: Product; onClose: () => void; onSaved: (id: string) => void }) {
  const { profile, companies, company } = useAuth();
  const toast = useToast();
  const mine = profile?.role === 'system_admin' ? companies : companies.filter((c) => c.id === profile?.company_id);
  const [v, setV] = useState<any>(() => p ? { ...p, price: String(p.price) } : { kind: '관급', company_id: mine.find((c) => c.id === company)?.id || mine[0]?.id || '', unit: 'EA', price: '', name: '', active: true });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    if (!v.name?.trim()) return toast('제품명을 넣어 주세요');
    if (!v.company_id) return toast('회사를 골라 주세요');
    const row: any = {
      company_id: v.company_id, kind: v.kind, category: v.category || null, name: v.name.trim(), spec: v.spec?.trim() || null, unit: v.unit || 'EA',
      price: Math.trunc(Number(String(v.price).replace(/[^\d.]/g, '')) || 0), maker: v.maker || null, g2b_no: v.g2b_no || null, contract_no: v.contract_no || null,
      contract_start: v.contract_start || null, contract_end: v.contract_end || null, note: v.note || null,
      g2b_url: v.g2b_url ? (/^https?:\/\//i.test(v.g2b_url) ? v.g2b_url : 'https://' + v.g2b_url) : null,
    };
    setBusy(true);
    try {
      const r = p ? await q<any>(sb.from('products').update(row).eq('id', p.id).select('id').single()) : await q<any>(sb.from('products').insert(row).select('id').single());
      toast(p ? '저장했습니다' : '제품을 등록했습니다'); onSaved(r.id);
    } catch (e: any) { toast('저장 실패: ' + e.message); }
    setBusy(false);
  };
  const F = ({ k, l, type = 'text', ph }: { k: string; l: string; type?: string; ph?: string }) => <div className="field"><label htmlFor={'pe_' + k}>{l}</label><input id={'pe_' + k} className="input" type={type} value={v[k] ?? ''} onChange={set(k)} placeholder={ph} /></div>;
  return (
    <Modal wide title={p ? '제품 정보 고치기' : '제품 등록'} onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={busy} onClick={save}>저장</button></>}>
      <div className="row">
        <div className="seg" role="group" aria-label="관급 · 사급">{(['관급', '사급'] as const).map((k) => <button key={k} type="button" className={v.kind === k ? 'on' : ''} aria-pressed={v.kind === k} onClick={() => setV({ ...v, kind: k })}>{k}자재</button>)}</div>
        <select className="input" style={{ width: 180 }} aria-label="회사" value={v.company_id} onChange={set('company_id')}>{mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {F({ k: 'name', l: '제품명 *', ph: '예: 탄성받침' })}
        {F({ k: 'spec', l: '규격', ph: '예: 400×400×52' })}
        <div className="field"><label htmlFor="pe_cat">분류</label><input id="pe_cat" className="input" list="pe_cats" value={v.category || ''} onChange={set('category')} /><datalist id="pe_cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div className="field"><label htmlFor="pe_price">단가 (원)</label><input id="pe_price" className="input num" inputMode="numeric" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value.replace(/[^\d]/g, '') })} />{v.price && <span className="muted">{won(Number(v.price))}원</span>}</div>
        <div className="field"><label htmlFor="pe_unit">단위</label><input id="pe_unit" className="input" list="pe_units" value={v.unit || ''} onChange={set('unit')} /><datalist id="pe_units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></div>
        {F({ k: 'maker', l: '제조사' })}
        {F({ k: 'g2b_no', l: '물품식별번호', ph: '10자리 / 8자리' })}
        {v.kind === '관급' && <>{F({ k: 'contract_no', l: '조달 계약번호' })}{F({ k: 'contract_start', l: '계약 시작일', type: 'date' })}{F({ k: 'contract_end', l: '계약 만료일', type: 'date' })}</>}
      </div>
      {F({ k: 'g2b_url', l: '조달청(종합쇼핑몰) 페이지 주소', ph: 'https://shop.g2b.go.kr/…' })}
      <div className="field"><label htmlFor="pe_note">비고</label><textarea id="pe_note" className="input" rows={3} value={v.note || ''} onChange={set('note')} /></div>
      {v.kind === '관급' && <span className="muted">계약 만료 60일 전부터 '실적 한눈에'와 제품 목록에 빨간 표시가 뜹니다.</span>}
    </Modal>
  );
}

/* ---------- 납품 입력 · 고치기 ---------- */
function DeliveryEdit({ products, fixed, d, onClose, onSaved }: { products: Product[]; fixed?: Product; d?: Delivery; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const usable = products.filter((p) => (p.active || p.id === d?.product_id) && canWrite(profile, p.company_id));
  const [projects, setProjects] = useState<{ id: string; name: string; client: string | null }[]>([]);
  useEffect(() => { q<any[]>(sb.from('projects').select('id, name, client').order('name')).then(setProjects).catch(() => {}); }, []);
  const [v, setV] = useState<any>(() => d ? { ...d, qty: String(d.qty), price: String(d.price), link: d.project_id ? 'p' : 't' } :
    { product_id: fixed?.id || '', delivered_on: today(), qty: '', price: fixed ? String(fixed.price) : '', project_id: '', project_name: '', client: '', contractor: '', note: '', link: 'p' });
  const [busy, setBusy] = useState(false);
  const prod = products.find((p) => p.id === v.product_id);
  // DB는 numeric으로 정확히 계산 → 화면도 소수 오차 없이 (예: 0.29 × 100 = 29)
  const amount = Math.trunc(Number((Number(v.qty || 0) * Number(v.price || 0)).toPrecision(15)));
  const pickProduct = (id: string) => { const p = products.find((x) => x.id === id); setV({ ...v, product_id: id, price: d ? v.price : String(p?.price ?? '') }); };
  const save = async () => {
    if (!prod) return toast('제품을 골라 주세요');
    if (!(Number(v.qty) > 0)) return toast('수량을 넣어 주세요');
    const row: any = {
      product_id: v.product_id, company_id: prod.company_id, kind: prod.kind, delivered_on: v.delivered_on, qty: Number(v.qty), price: Math.trunc(Number(v.price) || 0),
      project_id: v.link === 'p' && v.project_id ? v.project_id : null, project_name: v.link === 'p' && v.project_id ? null : v.project_name || null,
      client: v.client || null, contractor: v.contractor || null, note: v.note || null,
    };
    setBusy(true);
    try {
      if (d) await q(sb.from('deliveries').update(row).eq('id', d.id)); else await q(sb.from('deliveries').insert(row));
      toast(d ? '고쳤습니다' : '납품을 입력했습니다'); onSaved();
    } catch (e: any) { toast('저장 실패: ' + e.message); }
    setBusy(false);
  };
  const del = async () => { if (!d || !confirm('이 납품 기록을 지울까요?')) return; try { await q(sb.from('deliveries').delete().eq('id', d.id)); await logAction(d.project_id, '납품 기록 삭제', `${d.products?.name} ${d.delivered_on}`); onSaved(); } catch (e: any) { toast(e.message); } };
  return (
    <Modal title={d ? '납품 기록 고치기' : '납품 입력'} onClose={onClose} foot={<>{d && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>지우기</button>}<button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={busy} onClick={save}>저장</button></>}>
      <div className="field"><label htmlFor="de_p">제품 *</label>
        <select id="de_p" className="input" value={v.product_id} disabled={!!fixed} onChange={(e) => pickProduct(e.target.value)}>
          <option value="">제품 고르기</option>
          {(['관급', '사급'] as const).map((k) => <optgroup key={k} label={k + '자재'}>{usable.filter((p) => p.kind === k).map((p) => <option key={p.id} value={p.id}>{p.name}{p.spec ? ` (${p.spec})` : ''}</option>)}</optgroup>)}
        </select>
        {!usable.length && <span className="muted">입력할 수 있는 제품이 없습니다. 제품 목록에서 먼저 등록하세요.</span>}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <div className="field"><label htmlFor="de_d">납품일</label><input id="de_d" type="date" className="input" value={v.delivered_on} onChange={(e) => setV({ ...v, delivered_on: e.target.value })} /></div>
        <div className="field"><label htmlFor="de_q">수량 {prod && `(${prod.unit})`}</label><input id="de_q" className="input num" inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value.replace(/[^\d.]/g, '') })} /></div>
        <div className="field"><label htmlFor="de_pr">단가 (원)</label><input id="de_pr" className="input num" inputMode="numeric" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value.replace(/[^\d]/g, '') })} /></div>
      </div>
      <div className="banner blue"><span>금액 = TRUNC(수량 × 단가) = <b className="num">{won(amount)}</b>원</span>{prod && Number(v.price) !== prod.price && <span className="muted">제품 단가 {won(prod.price)}원과 다름</span>}</div>
      <div className="field"><span>공사</span>
        <div className="seg" role="group" aria-label="공사 입력 방식"><button type="button" className={v.link === 'p' ? 'on' : ''} aria-pressed={v.link === 'p'} onClick={() => setV({ ...v, link: 'p' })}>우리 프로젝트에서 고르기</button><button type="button" className={v.link === 't' ? 'on' : ''} aria-pressed={v.link === 't'} onClick={() => setV({ ...v, link: 't' })}>직접 입력 (외부 공사)</button></div>
        {v.link === 'p' ? <select className="input" aria-label="프로젝트" value={v.project_id || ''} onChange={(e) => { const pr = projects.find((x) => x.id === e.target.value); setV({ ...v, project_id: e.target.value, client: v.client || pr?.client || '' }); }}><option value="">프로젝트 고르기</option>{projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          : <input className="input" aria-label="공사명" placeholder="공사명" value={v.project_name || ''} onChange={(e) => setV({ ...v, project_name: e.target.value })} />}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div className="field"><label htmlFor="de_c">수요기관 · 발주처</label><input id="de_c" className="input" value={v.client || ''} onChange={(e) => setV({ ...v, client: e.target.value })} /></div>
        <div className="field"><label htmlFor="de_ct">시공사 · 계약상대자</label><input id="de_ct" className="input" value={v.contractor || ''} onChange={(e) => setV({ ...v, contractor: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="de_n">비고</label><input id="de_n" className="input" value={v.note || ''} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
    </Modal>
  );
}

/* ---------- 프로젝트 개요에 넣는 '이 현장 납품 제품' ---------- */
export function ProjectDeliveries({ pid }: { pid: string }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  useEffect(() => { q<Delivery[]>(sb.from('deliveries').select('*, products(name, spec, unit)').eq('project_id', pid).order('delivered_on', { ascending: false })).then(setRows).catch(() => setRows([])); }, [pid]);
  if (!rows?.length) return null;
  const tot = rows.reduce((s, x) => s + Number(x.amount), 0);
  return (
    <section className="card">
      <div className="card-h"><h2>이 현장 납품 제품 {rows.length}건 · {won(tot)}원</h2><Link className="btn sm" to="/products/deliveries">납품이력</Link></div>
      <DeliveryList rows={rows} />
    </section>
  );
}
