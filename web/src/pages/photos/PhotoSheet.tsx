import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sb, q, api } from '../../lib/supabase';
import { download } from '../../lib/files';
import { loadStructure, Structure, logAction } from '../../lib/data';
import { dt } from '../../lib/format';
import { useToast, useSigned, Loading, ErrorBox, Modal, Seg } from '../../lib/ui';
import { Photo, autoCaption, groupByDay, dayLabel, dayShort } from '../../lib/photos';
import { PhotoShell } from './PhotoShell';

type Item = { photo_id: string; caption: string };
type Sheet = { id: string; project_id: string; title: string; per_page: number; items: Item[]; updated_at: string; created_at: string; profiles?: { name: string | null } | null };
export const LAYOUT: Record<number, { cols: number; rows: number; label: string }> = {
  2: { cols: 1, rows: 2, label: '2장 (위아래)' }, 3: { cols: 1, rows: 3, label: '3장 (세로)' },
  4: { cols: 2, rows: 2, label: '4장 (2×2)' }, 6: { cols: 2, rows: 3, label: '6장 (2×3)' },
};
const dotDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${y}. ${m}. ${dd}.`; };

/* ---------- 사진대지 목록 ---------- */
export function SheetList() {
  const { pid = '' } = useParams();
  const [rows, setRows] = useState<Sheet[] | null>(null);
  const [proj, setProj] = useState<any>(null);
  const [err, setErr] = useState('');
  const toast = useToast();
  const load = () => q<Sheet[]>(sb.from('photo_sheets').select('*, profiles(name)').eq('project_id', pid).order('updated_at', { ascending: false })).then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); q<any>(sb.from('projects').select('name').eq('id', pid).single()).then(setProj).catch(() => {}); }, [pid]);
  const del = async (s: Sheet) => {
    if (!confirm(`'${s.title}'을(를) 지울까요? (사진은 그대로 남습니다)`)) return;
    try { await q(sb.from('photo_sheets').delete().eq('id', s.id)); toast('지웠습니다'); load(); } catch (e: any) { toast(e.message); }
  };
  return (
    <PhotoShell title={`${proj?.name || ''} 사진대지`} back={'/photos/' + pid}>
      {err && <ErrorBox msg={err} />}
      <div className="banner blue"><span>사진첩에서 <b>[고르기]</b> → 사진을 누르고 → <b>[사진대지 만들기]</b>를 누르면 새 사진대지가 생깁니다.</span></div>
      {!rows ? <Loading /> : !rows.length ? <div className="empty">아직 만든 사진대지가 없습니다.</div> :
        <div className="slist">{rows.map((s) => (
          <div key={s.id} className="sitem">
            <Link to={`/photos/${pid}/sheets/${s.id}`}><b>{s.title}</b><span className="muted">사진 {s.items.length}장 · 한 쪽 {LAYOUT[s.per_page]?.label} · {s.profiles?.name || '-'} · {dt(s.updated_at)}</span></Link>
            <button className="btn sm danger" onClick={() => del(s)}>지우기</button>
          </div>))}
        </div>}
    </PhotoShell>
  );
}

/* ---------- 사진대지 만들기 · 고치기 · 인쇄 · 엑셀 ---------- */
export function SheetEditor() {
  const { pid = '', sid = '' } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const [proj, setProj] = useState<any>(null);
  const [st, setSt] = useState<Structure | null>(null);
  const [s, setS] = useState<Sheet | null>(null);
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState(false);
  const [busyX, setBusyX] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<any>();

  const locName = useMemo(() => { const m = new Map<string, string>(); st?.facilities.forEach((fa) => fa.locations.forEach((l) => m.set(l.id, `${fa.name} ${l.name}`))); return (id: string | null) => (id && m.get(id)) || ''; }, [st]);
  const workName = useMemo(() => { const m = new Map(st?.works.map((w) => [w.id, w.name])); return (id: string | null) => (id && m.get(id)) || ''; }, [st]);

  const fetchPhotos = async (ids: string[]) => {
    const need = ids.filter((id) => !photos[id]);
    if (!need.length) return;
    const rows = await q<Photo[]>(sb.from('photos').select('*').in('id', need));
    setPhotos((p) => ({ ...p, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));
  };
  useEffect(() => {
    (async () => {
      const [sh, pr, stc] = await Promise.all([
        q<Sheet>(sb.from('photo_sheets').select('*').eq('id', sid).single()),
        q<any>(sb.from('projects').select('id, name').eq('id', pid).single()),
        loadStructure(pid),
      ]);
      setS(sh); setProj(pr); setSt(stc);
      await fetchPhotos(sh.items.map((i) => i.photo_id));
    })().catch((e) => setErr(e.message));
  }, [sid]);

  const save = async (cur: Sheet) => {
    setSaving(true);
    try { await q(sb.from('photo_sheets').update({ title: cur.title, per_page: cur.per_page, items: cur.items, updated_at: new Date().toISOString() }).eq('id', cur.id)); setDirty(false); }
    catch (e: any) { toast('저장 실패: ' + e.message); }
    setSaving(false);
  };
  const change = (patch: Partial<Sheet>) => {
    if (!s) return;
    const n = { ...s, ...patch }; setS(n); setDirty(true);
    clearTimeout(timer.current); timer.current = setTimeout(() => save(n), 900);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const items = (s?.items || []).filter((i) => photos[i.photo_id]);
  const missing = (s?.items.length || 0) - items.length;
  const urls = useSigned(items.map((i) => photos[i.photo_id].storage_path));
  const L = LAYOUT[s?.per_page || 3];
  const pages: Item[][] = [];
  for (let k = 0; k < items.length; k += s?.per_page || 3) pages.push(items.slice(k, k + (s?.per_page || 3)));

  const move = (idx: number, d: number) => { const a = [...s!.items]; const j = idx + d; if (j < 0 || j >= a.length) return; [a[idx], a[j]] = [a[j], a[idx]]; change({ items: a }); };
  const setCap = (idx: number, caption: string) => { const a = [...s!.items]; a[idx] = { ...a[idx], caption }; change({ items: a }); };
  const drop = (idx: number) => change({ items: s!.items.filter((_, j) => j !== idx) });
  const sortByDate = () => change({ items: [...s!.items].sort((a, b) => (photos[a.photo_id]?.taken_at || '').localeCompare(photos[b.photo_id]?.taken_at || '')) });

  const excel = async () => {
    if (dirty) await save(s!);
    setBusyX(true);
    try {
      const r = await api('/api/photos/sheet-xlsx', { sheet_id: sid });
      await download(r.path, r.name);
      await logAction(pid, '사진대지 엑셀', s!.title);
    } catch (e: any) { toast('엑셀 만들기 실패: ' + e.message); }
    setBusyX(false);
  };
  const print = async () => { if (dirty) await save(s!); window.print(); };

  if (err) return <PhotoShell title="사진대지" back={`/photos/${pid}/sheets`}><ErrorBox msg={err} /></PhotoShell>;
  if (!s) return <PhotoShell title="사진대지" back={`/photos/${pid}/sheets`}><Loading /></PhotoShell>;

  return (
    <PhotoShell title="사진대지" back={`/photos/${pid}/sheets`} right={<span className="saved">{saving ? '저장 중…' : dirty ? '고치는 중' : '저장됨'}</span>}>
      <div className="sheet-tools no-print">
        <div className="field" style={{ flex: '2 1 260px' }}><label htmlFor="stt">제목</label><input id="stt" className="input" value={s.title} onChange={(e) => change({ title: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 300px' }}><span>한 쪽에 몇 장</span>
          <Seg label="한 쪽 사진 수" value={String(s.per_page) as any} onChange={(v) => change({ per_page: Number(v) })} items={[['2', '2장'], ['3', '3장'], ['4', '4장'], ['6', '6장']]} /></div>
        <div className="row" style={{ alignSelf: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={() => setPick(true)}>＋ 사진 넣기</button>
          <button className="btn" onClick={sortByDate}>날짜순 정렬</button>
          <button className="btn" onClick={print} disabled={!items.length}>인쇄 · PDF</button>
          <button className="btn pri" onClick={excel} disabled={busyX || !items.length}>{busyX ? '만드는 중…' : '엑셀로 받기'}</button>
        </div>
      </div>
      {missing > 0 && <div className="banner no-print">지워진 사진 {missing}장은 빠졌습니다.</div>}

      <div className="sheet-wrap">
        <aside className="sheet-list no-print" aria-label="사진 순서와 설명">
          <h3>사진 {items.length}장 · {pages.length}쪽</h3>
          {s.items.map((it, idx) => { const p = photos[it.photo_id]; if (!p) return null; return (
            <div key={it.photo_id + idx} className="sli">
              <span className="no num">{idx + 1}</span>
              {urls[p.storage_path] && <img src={urls[p.storage_path]} alt="" loading="lazy" />}
              <div className="txt">
                <span className="muted">{dotDay(p.taken_day)} · {[locName(p.location_id), workName(p.work_item_id)].filter(Boolean).join(' ') || '위치 없음'}</span>
                <input className="input" aria-label={`${idx + 1}번 설명`} value={it.caption} onChange={(e) => setCap(idx, e.target.value)} placeholder={autoCaption(p)} />
              </div>
              <div className="ops">
                <button className="btn sm" aria-label="위로" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
                <button className="btn sm" aria-label="아래로" disabled={idx === s.items.length - 1} onClick={() => move(idx, 1)}>↓</button>
                <button className="btn sm" aria-label="빼기" onClick={() => drop(idx)}>✕</button>
              </div>
            </div>); })}
          {!s.items.length && <div className="empty">[＋ 사진 넣기]로 사진을 고르세요.</div>}
        </aside>

        <div className="sheet-print" aria-label="인쇄 미리보기">
          {pages.map((pg, n) => (
            <div key={n} className={`a4 per${s.per_page}`}>
              <div className="a4-h"><b>사 진 대 지</b></div>
              <table className="a4-meta"><tbody><tr><th>공 사 명</th><td>{proj?.name}</td><th>쪽</th><td className="num">{n + 1} / {pages.length}</td></tr></tbody></table>
              <div className="a4-grid" style={{ gridTemplateColumns: `repeat(${L.cols}, 1fr)`, gridTemplateRows: `repeat(${L.rows}, 1fr)` }}>
                {pg.map((it, k) => { const p = photos[it.photo_id]; return (
                  <div key={k} className="blk">
                    <div className="img">{urls[p.storage_path] && <img src={urls[p.storage_path]} alt="" />}</div>
                    <table><tbody>
                      <tr><th>일 자</th><td>{dotDay(p.taken_day)}</td></tr>
                      <tr><th>위 치</th><td>{[locName(p.location_id), workName(p.work_item_id)].filter(Boolean).join(' · ')}</td></tr>
                      <tr><th>내 용</th><td>{it.caption || autoCaption(p)}</td></tr>
                    </tbody></table>
                  </div>); })}
              </div>
            </div>))}
        </div>
      </div>

      {pick && <PickModal pid={pid} have={new Set(s.items.map((i) => i.photo_id))} onClose={() => setPick(false)} onPick={async (ps) => {
        setPhotos((x) => ({ ...x, ...Object.fromEntries(ps.map((p) => [p.id, p])) }));
        change({ items: [...s.items, ...ps.sort((a, b) => a.taken_at.localeCompare(b.taken_at)).map((p) => ({ photo_id: p.id, caption: autoCaption(p) }))] });
        setPick(false);
      }} />}
      <button className="btn no-print" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/photos/' + pid)}>‹ 사진첩으로</button>
    </PhotoShell>
  );
}

/* ---------- 사진 고르기 (사진대지에 넣기) ---------- */
function PickModal({ pid, have, onClose, onPick }: { pid: string; have: Set<string>; onClose: () => void; onPick: (ps: Photo[]) => void }) {
  const [days, setDays] = useState<{ day: string; n: number }[]>([]);
  const [day, setDay] = useState('');
  const [ps, setPs] = useState<Photo[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { q<any[]>(sb.rpc('photo_days', { p: pid })).then((d) => { setDays(d); if (d[0]) setDay(d[0].day); else setPs([]); }); }, [pid]);
  useEffect(() => { if (day) { setPs(null); q<Photo[]>(sb.from('photos').select('*').eq('project_id', pid).eq('taken_day', day).order('taken_at')).then(setPs); } }, [day]);
  const urls = useSigned((ps || []).map((p) => p.thumb_path || p.storage_path));
  const [picked, setPicked] = useState<Record<string, Photo>>({});
  const tog = (p: Photo) => { const n = new Set(sel); const m = { ...picked }; if (n.has(p.id)) { n.delete(p.id); delete m[p.id]; } else { n.add(p.id); m[p.id] = p; } setSel(n); setPicked(m); };
  return (
    <Modal wide title="사진 넣기" onClose={onClose} foot={<><span className="muted" style={{ marginRight: 'auto' }}>{sel.size}장 고름 (여러 날짜에서 고를 수 있음)</span><button className="btn" onClick={onClose}>취소</button><button className="btn pri" disabled={!sel.size} onClick={() => onPick(Object.values(picked))}>{sel.size}장 넣기</button></>}>
      <div className="pdays">{days.map((d) => <button key={d.day} className={day === d.day ? 'on' : ''} aria-pressed={day === d.day} onClick={() => setDay(d.day)}>{dayShort(d.day)} <small>{d.n}</small></button>)}</div>
      {!ps ? <Loading /> : !ps.length ? <div className="empty">사진이 없습니다.</div> : groupByDay(ps).map(([d, list]) => (
        <section key={d} className="pday"><div className="pday-h"><h2>{dayLabel(d)}</h2></div>
          <div className="pgrid">{list.map((p) => { const already = have.has(p.id); return (
            <button key={p.id} className={'ptile' + (sel.has(p.id) ? ' on' : '') + (already ? ' dim' : '')} aria-pressed={sel.has(p.id)} onClick={() => tog(p)} aria-label={p.kind + (already ? ' (이미 들어 있음)' : '')}>
              {urls[p.thumb_path || p.storage_path] && <img src={urls[p.thumb_path || p.storage_path]} alt="" loading="lazy" />}
              <span className="k">{already ? '들어 있음' : p.kind}</span><span className="ck" aria-hidden>{sel.has(p.id) ? '✓' : ''}</span>
            </button>); })}</div></section>))}
    </Modal>
  );
}
