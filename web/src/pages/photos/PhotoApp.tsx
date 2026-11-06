import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { sb, q, BUCKET } from '../../lib/supabase';
import { download, signedUrls } from '../../lib/files';
import { loadStructure, Structure, logAction } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { PHOTO_KINDS } from '../../lib/format';
import { useToast, useSigned, Loading, ErrorBox, Modal } from '../../lib/ui';
import { Photo, UpItem, Tags, uploadPhotos, groupByDay, dayLabel, dayShort, hm, autoCaption } from '../../lib/photos';
import { PhotoShell } from './PhotoShell';

const PAGE = 240;
const thumb = (p: Photo) => p.thumb_path || p.storage_path;

/* =====================================================================
   1) 프로젝트 고르기
   ===================================================================== */
export function PhotoHome() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => { q<any[]>(sb.rpc('photo_projects')).then(setRows).catch((e) => setErr(e.message)); }, []);
  const list = (rows || []).filter((r) => all || r.status === 'active' || r.n > 0);
  const urls = useSigned(list.map((r) => r.cover));
  return (
    <PhotoShell title="GM 사진">
      {err && <ErrorBox msg={err} />}
      {!rows ? <Loading /> : <>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="sub">프로젝트를 고르면 날짜별로 사진이 모여 있습니다.</span>
          <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 사진 없는 끝난 현장도 보기</label>
        </div>
        {!list.length && <div className="empty">볼 수 있는 프로젝트가 없습니다. 본사에 현장 배정을 요청하세요.</div>}
        <div className="pproj">
          {list.map((r) => (
            <Link key={r.project_id} to={'/photos/' + r.project_id} className="pcard">
              <div className="cover">{r.cover && urls[r.cover] ? <img src={urls[r.cover]} alt="" loading="lazy" /> : <span>📷</span>}</div>
              <div className="meta"><b>{r.name}</b><span>{r.n ? `사진 ${r.n.toLocaleString()}장 · 최근 ${dayShort(r.last_day)}` : '아직 사진 없음'}{r.status !== 'active' ? ' · 끝난 현장' : ''}</span></div>
            </Link>))}
        </div>
      </>}
    </PhotoShell>
  );
}

/* =====================================================================
   2) 프로젝트 사진첩: 날짜별 묶음 · 거르기 · 고르기 · 올리기
   ===================================================================== */
export function PhotoAlbum() {
  const { pid = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { profile, canEdit } = useAuth();
  const day = sp.get('day') || '';
  const [proj, setProj] = useState<any>(null);
  const [st, setSt] = useState<Structure | null>(null);
  const [canField, setCanField] = useState(false);
  const [days, setDays] = useState<{ day: string; n: number }[]>([]);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [more, setMore] = useState(false);
  const [f, setF] = useState({ kind: '', loc: '', work: '' });
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [view, setView] = useState<{ list: Photo[]; i: number } | null>(null);
  const [upOpen, setUpOpen] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [err, setErr] = useState('');

  const locName = useMemo(() => { const m = new Map<string, string>(); st?.facilities.forEach((fa) => fa.locations.forEach((l) => m.set(l.id, `${fa.name} ${l.name}`))); return (id: string | null) => (id && m.get(id)) || ''; }, [st]);
  const workName = useMemo(() => { const m = new Map(st?.works.map((w) => [w.id, w.name])); return (id: string | null) => (id && m.get(id)) || ''; }, [st]);

  const loadPhotos = async (n = PAGE) => {
    let qy = sb.from('photos').select('*, profiles(name, username)').eq('project_id', pid).order('taken_at', { ascending: false }).range(0, n);
    if (day) qy = qy.eq('taken_day', day);
    if (f.kind) qy = qy.eq('kind', f.kind);
    if (f.loc) qy = qy.eq('location_id', f.loc);
    if (f.work) qy = qy.eq('work_item_id', f.work);
    const rows = await q<Photo[]>(qy);
    setMore(rows.length > n); setPhotos(rows.slice(0, n));
  };
  const loadDays = () => q<any[]>(sb.rpc('photo_days', { p: pid })).then(setDays);
  useEffect(() => {
    setPhotos(null);
    Promise.all([
      q<any>(sb.from('projects').select('id, name, status').eq('id', pid).single()).then(setProj),
      loadStructure(pid).then(setSt),
      q<boolean>(sb.rpc('can_field', { p: pid })).then(setCanField).catch(() => setCanField(false)),
      loadDays(),
    ]).catch((e) => setErr(e.message));
  }, [pid]);
  useEffect(() => { loadPhotos().catch((e) => setErr(e.message)); }, [pid, day, f.kind, f.loc, f.work]);

  // ?photo=… 로 들어오면 그 사진을 바로 엶 (현장 앱 · 알림에서 연결)
  const openId = sp.get('photo');
  useEffect(() => {
    if (!openId || !photos) return;
    const i = photos.findIndex((p) => p.id === openId);
    if (i >= 0) setView({ list: photos, i });
    else q<Photo>(sb.from('photos').select('*, profiles(name, username)').eq('id', openId).single()).then((p) => setView({ list: [p], i: 0 })).catch(() => {});
  }, [openId, photos === null]);
  const closeView = () => { setView(null); if (openId) { sp.delete('photo'); setSp(sp, { replace: true }); } };

  const groups = useMemo(() => groupByDay(photos || []), [photos]);
  const urls = useSigned((photos || []).map(thumb));
  const setDay = (d: string) => { if (d) sp.set('day', d); else sp.delete('day'); setSp(sp, { replace: true }); };
  const total = days.reduce((a, d) => a + d.n, 0);
  const mine = (p: Photo) => canEdit || p.uploaded_by === profile?.id;

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const picked = (photos || []).filter((p) => sel?.has(p.id));

  const makeSheet = async () => {
    const items = [...picked].sort((a, b) => a.taken_at.localeCompare(b.taken_at)).map((p) => ({ photo_id: p.id, caption: autoCaption(p) }));
    try {
      const r = await q<any>(sb.from('photo_sheets').insert({ project_id: pid, title: `${proj?.name || ''} 사진대지`, per_page: items.length <= 2 ? 2 : 3, items }).select('id').single());
      nav(`/photos/${pid}/sheets/${r.id}`);
    } catch (e: any) { toast('사진대지를 만들지 못했습니다: ' + e.message); }
  };
  const downloadSel = async () => {
    toast(`${picked.length}장 내려받는 중…`);
    let n = 0;
    for (const p of picked) { n++; try { await download(p.storage_path, `${p.taken_day}_${p.kind.replace(/\W+/g, '')}_${String(n).padStart(3, '0')}.jpg`); } catch (e: any) { toast(e.message); } await new Promise((r) => setTimeout(r, 300)); }
  };
  const removeSel = async () => {
    const ok = picked.filter(mine);
    if (!ok.length) return toast('지울 수 있는 사진이 없습니다 (자기가 올린 사진만 지울 수 있음)');
    if (!confirm(`${ok.length}장을 지울까요? 되돌릴 수 없습니다.${ok.length < picked.length ? `\n(남이 올린 ${picked.length - ok.length}장은 빼고 지웁니다)` : ''}`)) return;
    try {
      const gone = await q<any[]>(sb.from('photos').delete().in('id', ok.map((p) => p.id)).select('id, storage_path, thumb_path'));
      await sb.storage.from(BUCKET).remove(gone.flatMap((g) => [g.storage_path, g.thumb_path].filter(Boolean)));
      await logAction(pid, '사진 삭제', `${gone.length}장`);
      toast(`${gone.length}장 지웠습니다`); setSel(new Set()); loadPhotos(); loadDays();
    } catch (e: any) { toast('지우기 실패: ' + e.message); }
  };

  const right = <>
    <Link className="ib wide" to={`/photos/${pid}/sheets`}>사진대지</Link>
    <button className="ib wide" aria-pressed={!!sel} onClick={() => setSel(sel ? null : new Set())}>{sel ? '끝' : '고르기'}</button>
  </>;

  return (
    <PhotoShell title={proj?.name || '사진첩'} back="/photos" right={right}>
      {err && <ErrorBox msg={err} />}
      <div className="pdays" role="group" aria-label="날짜">
        <button className={!day ? 'on' : ''} aria-pressed={!day} onClick={() => setDay('')}>전체 <small>{total.toLocaleString()}</small></button>
        {days.map((d) => <button key={d.day} className={day === d.day ? 'on' : ''} aria-pressed={day === d.day} onClick={() => setDay(d.day)}>{dayShort(d.day)} <small>{d.n}</small></button>)}
      </div>
      <div className="pfilter">
        <select className="input" aria-label="구분" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">구분 전체</option>{PHOTO_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <select className="input" aria-label="위치" value={f.loc} onChange={(e) => setF({ ...f, loc: e.target.value })}><option value="">위치 전체</option>{st?.facilities.flatMap((fa) => fa.locations.map((l) => <option key={l.id} value={l.id}>{fa.name} › {l.name}</option>))}</select>
        <select className="input" aria-label="공종" value={f.work} onChange={(e) => setF({ ...f, work: e.target.value })}><option value="">공종 전체</option>{st?.works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </div>

      {!photos ? <Loading /> : !photos.length ? <div className="empty">{day || f.kind || f.loc || f.work ? '조건에 맞는 사진이 없습니다.' : '아직 사진이 없습니다. 아래 [사진 올리기]로 시작하세요.'}</div> :
        groups.map(([d, ps]) => (
          <section key={d} className="pday">
            <div className="pday-h">
              <h2>{dayLabel(d)}</h2><span className="muted">{ps.length}장{!day && days.find((x) => x.day === d)?.n !== ps.length ? ' (일부)' : ''}</span>
              {sel && <button className="btn sm" onClick={() => setSel((s) => { const n = new Set(s); const allOn = ps.every((p) => n.has(p.id)); ps.forEach((p) => (allOn ? n.delete(p.id) : n.add(p.id))); return n; })}>{ps.every((p) => sel.has(p.id)) ? '이 날 빼기' : '이 날 모두'}</button>}
            </div>
            <div className="pgrid">
              {ps.map((p) => (
                <button key={p.id} className={'ptile' + (sel?.has(p.id) ? ' on' : '')} aria-pressed={sel ? sel.has(p.id) : undefined}
                  aria-label={`${hm(p.taken_at)} ${p.kind} ${locName(p.location_id)}`}
                  onClick={() => (sel ? toggle(p.id) : setView({ list: photos, i: photos.indexOf(p) }))}>
                  {urls[thumb(p)] && <img src={urls[thumb(p)]} alt="" loading="lazy" />}
                  <span className="k">{p.kind}</span>
                  {sel && <span className="ck" aria-hidden>{sel.has(p.id) ? '✓' : ''}</span>}
                </button>))}
            </div>
          </section>))}
      {more && <button className="btn block" onClick={() => loadPhotos((photos?.length || 0) + PAGE)}>더 보기</button>}

      {sel ? (
        <div className="pbar" role="toolbar" aria-label="고른 사진">
          <b>{sel.size}장</b>
          <button className="btn pri" disabled={!sel.size} onClick={makeSheet}>사진대지 만들기</button>
          <button className="btn" disabled={!sel.size} onClick={downloadSel}>내려받기</button>
          {canField && <button className="btn" disabled={!sel.size} onClick={() => setBulk(true)}>정보 바꾸기</button>}
          {canField && <button className="btn danger" disabled={!sel.size} onClick={removeSel}>지우기</button>}
        </div>
      ) : canField && !upOpen && <button className="pfab" onClick={() => setUpOpen(true)}>📷 사진 올리기</button>}

      {upOpen && st && <UploadPanel pid={pid} st={st} onClose={() => setUpOpen(false)} onDone={() => { loadPhotos(); loadDays(); }} />}
      {bulk && st && <EditModal st={st} photos={picked.filter(mine)} skipped={picked.length - picked.filter(mine).length} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); loadPhotos(); }} />}
      {view && <Viewer list={view.list} start={view.i} st={st} locName={locName} workName={workName} canChange={(p) => canField && mine(p)} onClose={closeView} onChanged={() => { loadPhotos(); loadDays(); }} />}
    </PhotoShell>
  );
}

/* =====================================================================
   올리기: 찍기 · 앨범 · 여러 장 · 3장씩 동시에 · 실패만 다시
   ===================================================================== */
function UploadPanel({ pid, st, onClose, onDone }: { pid: string; st: Structure; onClose: () => void; onDone: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const cam = useRef<HTMLInputElement>(null); const alb = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<(UpItem & { url: string })[]>([]);
  const [tags, setTags] = useState<Tags>(() => { try { return { kind: '시공 중', location_id: '', work_item_id: '', ...JSON.parse(localStorage.getItem('gm.photoTags.' + pid) || '{}'), memo: '' }; } catch { return { kind: '시공 중', location_id: '', work_item_id: '', memo: '' }; } });
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.url)), []);
  const add = (fs: File[]) => {
    const imgs = fs.filter((x) => x.type.startsWith('image/'));
    if (imgs.length < fs.length) toast('사진이 아닌 파일은 뺐습니다');
    setItems((x) => [...x, ...imgs.map((file) => ({ file, state: 'wait' as const, url: URL.createObjectURL(file) }))]);
    if (!gps) navigator.geolocation?.getCurrentPosition((p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 5000, maximumAge: 60000 });
  };
  const locs = st.facilities.flatMap((fa) => fa.locations.map((l) => ({ id: l.id, name: `${fa.name} › ${l.name}` })));
  const works = tags.location_id && st.lw.some((x) => x.location_id === tags.location_id) ? st.works.filter((w) => st.lw.some((x) => x.location_id === tags.location_id && x.work_item_id === w.id)) : st.works;
  const done = items.filter((i) => i.state === 'done').length;
  const fail = items.filter((i) => i.state === 'fail').length;
  const go = async () => {
    setBusy(true);
    localStorage.setItem('gm.photoTags.' + pid, JSON.stringify({ kind: tags.kind, location_id: tags.location_id, work_item_id: tags.work_item_id }));
    items.forEach((i) => { if (i.state === 'fail') i.state = 'wait'; });
    await uploadPhotos(pid, profile!.id, items, tags, gps, () => tick((n) => n + 1));
    setBusy(false); onDone();
    const f = items.filter((i) => i.state === 'fail').length;
    if (!f) { toast(`${items.length}장 올렸습니다`); onClose(); }
    else toast(`${f}장 실패 — 신호가 좋은 곳에서 [다시 올리기]를 누르세요`);
  };
  return (
    <Modal title="사진 올리기" onClose={() => !busy && onClose()} foot={<>
      <span className="muted" style={{ marginRight: 'auto' }}>{busy ? `${done} / ${items.length}장 올리는 중…` : fail ? `${fail}장 실패` : gps ? 'GPS 기록됨' : ''}</span>
      <button className="btn" disabled={busy} onClick={onClose}>닫기</button>
      <button className="btn pri" disabled={busy || !items.length || done === items.length} onClick={go}>{fail ? '다시 올리기' : `${items.length - done}장 올리기`}</button>
    </>}>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button className="btn pri" style={{ height: 72, fontSize: 16 }} disabled={busy} onClick={() => cam.current?.click()}>📷 찍기</button>
        <button className="btn" style={{ height: 72, fontSize: 16, fontWeight: 700 }} disabled={busy} onClick={() => alb.current?.click()}>🖼 앨범에서 여러 장</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <input ref={alb} type="file" accept="image/*" multiple hidden onChange={(e) => { add(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>
      {items.length > 0 && <div className="pqueue">{items.map((it, i) => (
        <div key={it.url} className={'q ' + it.state} title={it.err}>
          <img src={it.url} alt="" />
          {it.state === 'up' && <span className="st">↑</span>}{it.state === 'done' && <span className="st">✓</span>}{it.state === 'fail' && <span className="st">!</span>}
          {!busy && it.state !== 'done' && <button aria-label="빼기" onClick={() => { URL.revokeObjectURL(it.url); setItems(items.filter((_, j) => j !== i)); }}>✕</button>}
        </div>))}</div>}
      <span className="muted">촬영 날짜는 사진에 저장된 시각으로 자동 분류됩니다. 아래 정보는 이번에 올리는 사진 모두에 붙습니다 (다음에도 기억).</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>구분</span>
      <div className="chips">{PHOTO_KINDS.map((k) => <button key={k} className={tags.kind === k ? 'on' : ''} aria-pressed={tags.kind === k} onClick={() => setTags({ ...tags, kind: k })}>{k}</button>)}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div className="field"><label htmlFor="ul">시설물 › 위치</label><select id="ul" className="input" value={tags.location_id} onChange={(e) => setTags({ ...tags, location_id: e.target.value })}><option value="">선택 안 함</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="field"><label htmlFor="uw">공종</label><select id="uw" className="input" value={tags.work_item_id} onChange={(e) => setTags({ ...tags, work_item_id: e.target.value })}><option value="">선택 안 함</option>{works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="um">메모 (선택)</label><input id="um" className="input" value={tags.memo} onChange={(e) => setTags({ ...tags, memo: e.target.value })} placeholder="예: 받침 철거 후 상태" /></div>
    </Modal>
  );
}

/* =====================================================================
   정보 바꾸기 (한 장 · 여러 장)
   ===================================================================== */
function EditModal({ st, photos, skipped = 0, onClose, onSaved }: { st: Structure; photos: Photo[]; skipped?: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const one = photos.length === 1 ? photos[0] : null;
  const KEEP = '__keep';
  const [v, setV] = useState({
    kind: one?.kind ?? KEEP, location_id: one ? one.location_id || '' : KEEP, work_item_id: one ? one.work_item_id || '' : KEEP,
    memo: one?.memo || '', caption: one?.caption || '', taken: one ? toLocal(one.taken_at) : '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const patch: any = {};
    if (v.kind !== KEEP) patch.kind = v.kind;
    if (v.location_id !== KEEP) patch.location_id = v.location_id || null;
    if (v.work_item_id !== KEEP) patch.work_item_id = v.work_item_id || null;
    if (one) { patch.memo = v.memo || null; patch.caption = v.caption || null; if (v.taken) patch.taken_at = new Date(v.taken).toISOString(); }
    if (!Object.keys(patch).length) return onClose();
    setBusy(true);
    try {
      const r = await q<any[]>(sb.from('photos').update(patch).in('id', photos.map((p) => p.id)).select('id'));
      toast(`${r.length}장 바꿨습니다`); onSaved();
    } catch (e: any) { toast('저장 실패: ' + e.message); }
    setBusy(false);
  };
  const opt = (label: string) => !one && <option value={KEEP}>그대로 ({label})</option>;
  return (
    <Modal title={one ? '사진 정보' : `${photos.length}장 정보 바꾸기`} onClose={onClose} foot={<><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={busy || !photos.length} onClick={save}>저장</button></>}>
      {skipped > 0 && <div className="banner">남이 올린 {skipped}장은 바꿀 수 없어 뺐습니다.</div>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <div className="field"><label htmlFor="ek">구분</label><select id="ek" className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{opt('구분')}{PHOTO_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="field"><label htmlFor="el">시설물 › 위치</label><select id="el" className="input" value={v.location_id} onChange={(e) => setV({ ...v, location_id: e.target.value })}>{opt('위치')}<option value="">선택 안 함</option>{st.facilities.flatMap((fa) => fa.locations.map((l) => <option key={l.id} value={l.id}>{fa.name} › {l.name}</option>))}</select></div>
        <div className="field"><label htmlFor="ew">공종</label><select id="ew" className="input" value={v.work_item_id} onChange={(e) => setV({ ...v, work_item_id: e.target.value })}>{opt('공종')}<option value="">선택 안 함</option>{st.works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        {one && <div className="field"><label htmlFor="et">촬영 일시</label><input id="et" type="datetime-local" className="input" value={v.taken} onChange={(e) => setV({ ...v, taken: e.target.value })} /></div>}
      </div>
      {one && <>
        <div className="field"><label htmlFor="em">메모</label><input id="em" className="input" value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} /></div>
        <div className="field"><label htmlFor="ec">사진대지 설명 (비우면 위치 · 공종 · 구분으로 자동)</label><input id="ec" className="input" value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} /></div>
      </>}
    </Modal>
  );
}
function toLocal(iso: string) { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

/* =====================================================================
   크게 보기: 넘기기(밀기 · ← →) · 정보 · 내려받기 · 고치기 · 지우기
   ===================================================================== */
function Viewer({ list, start, st, locName, workName, canChange, onClose, onChanged }: {
  list: Photo[]; start: number; st: Structure | null; locName: (id: string | null) => string; workName: (id: string | null) => string;
  canChange: (p: Photo) => boolean; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [i, setI] = useState(start);
  const [full, setFull] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState(false);
  const [info, setInfo] = useState(true);
  const touch = useRef<number | null>(null);
  const p = list[i];
  useEffect(() => {
    const need = [list[i - 1], list[i], list[i + 1]].filter(Boolean).map((x) => x.storage_path).filter((s) => !full[s]);
    if (need.length) signedUrls(need).then((u) => setFull((f) => ({ ...f, ...u })));
  }, [i]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (edit) return; if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); if (e.key === 'ArrowRight') setI((x) => Math.min(list.length - 1, x + 1)); if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [edit, list.length]);
  if (!p) return null;
  const remove = async () => {
    if (!confirm('이 사진을 지울까요? 되돌릴 수 없습니다.')) return;
    try {
      const g = await q<any[]>(sb.from('photos').delete().eq('id', p.id).select('storage_path, thumb_path'));
      if (!g.length) throw new Error('지울 권한이 없습니다');
      await sb.storage.from(BUCKET).remove([g[0].storage_path, g[0].thumb_path].filter(Boolean));
      await logAction(p.project_id, '사진 삭제', '1장');
      toast('지웠습니다'); onChanged(); onClose();
    } catch (e: any) { toast(e.message); }
  };
  const map = p.lat && p.lng ? `https://map.kakao.com/link/map/사진위치,${p.lat},${p.lng}` : '';
  return (
    <div className="pview" role="dialog" aria-modal="true" aria-label="사진 크게 보기"
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (dx > 60) setI((x) => Math.max(0, x - 1)); if (dx < -60) setI((x) => Math.min(list.length - 1, x + 1)); }}>
      <div className="top">
        <button className="ib" onClick={onClose} aria-label="닫기">✕</button>
        <span className="num">{i + 1} / {list.length}</span>
        <span style={{ flex: 1 }} />
        <button className="ib wide" onClick={() => setInfo(!info)} aria-pressed={info}>정보</button>
        <button className="ib wide" onClick={() => download(p.storage_path, `${p.taken_day}_${p.kind.replace(/\W+/g, '')}.jpg`).catch((e) => toast(e.message))}>내려받기</button>
        {canChange(p) && <button className="ib wide" onClick={() => setEdit(true)}>고치기</button>}
        {canChange(p) && <button className="ib wide" onClick={remove}>지우기</button>}
      </div>
      <div className="stage" onClick={() => setInfo(!info)}>
        {full[p.storage_path] ? <img key={p.id} src={full[p.storage_path]} alt={autoCaption(p) || p.kind} /> : <span className="sub" style={{ color: '#ccc' }}>불러오는 중…</span>}
      </div>
      {i > 0 && <button className="nav prev" aria-label="이전 사진" onClick={() => setI(i - 1)}>‹</button>}
      {i < list.length - 1 && <button className="nav next" aria-label="다음 사진" onClick={() => setI(i + 1)}>›</button>}
      {info && <div className="info">
        <b>{dayLabel(p.taken_day)} {hm(p.taken_at)} · {p.kind}</b>
        <span>{[locName(p.location_id), workName(p.work_item_id)].filter(Boolean).join(' · ') || '위치 · 공종 없음'}</span>
        {(p.caption || p.memo) && <span>{p.caption || p.memo}</span>}
        <span className="muted" style={{ color: '#B8C2D3' }}>올린 사람 {p.profiles?.name || p.profiles?.username || '-'}{map && <> · <a href={map} target="_blank" rel="noreferrer" style={{ color: '#F0A35E' }}>지도에서 보기</a></>}</span>
      </div>}
      {edit && st && <EditModal st={st} photos={[p]} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); onClose(); }} />}
    </div>
  );
}
