import { useEffect, useRef, useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { upload } from '../../lib/files';
import { loadStructure, Structure } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { useField } from './FieldShell';
import { today, PHOTO_KINDS, dt } from '../../lib/format';
import { useToast, useSigned } from '../../lib/ui';

export default function FieldPhoto() {
  const { profile } = useAuth();
  const { pid, report, ensureReport } = useField();
  const toast = useToast();
  const cam = useRef<HTMLInputElement>(null); const alb = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [st, setSt] = useState<Structure | null>(null);
  const [reqs, setReqs] = useState<any[]>([]);
  const [list, setList] = useState<any[]>([]);
  const [m, setM] = useState({ location_id: '', work_item_id: '', kind: '시공 중', memo: '', request_id: '' });
  const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const urls = useSigned(list.map((p) => p.storage_path));

  const load = async () => {
    const [s, r, l] = await Promise.all([
      loadStructure(pid),
      q<any[]>(sb.from('requests').select('id, title').eq('project_id', pid).eq('to_user', profile!.id).neq('status', 'done')),
      q<any[]>(sb.from('photos').select('*').eq('project_id', pid).gte('created_at', today() + 'T00:00:00').order('created_at', { ascending: false })),
    ]);
    setSt(s); setReqs(r); setList(l);
  };
  useEffect(() => { load().catch((e) => toast(e.message)); }, [pid]);
  const pick = (fs: File[]) => {
    if (!fs.length) return;
    setFiles((x) => [...x, ...fs]); setPreviews((x) => [...x, ...fs.map((f) => URL.createObjectURL(f))]);
    navigator.geolocation?.getCurrentPosition((p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { timeout: 5000 });
  };
  const send = async () => {
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await ensureReport();
      for (const f of files) {
        const { path } = await upload(pid, 'photos/' + today(), f, f.name, true);
        await q(sb.from('photos').insert({ project_id: pid, report_id: r.id, location_id: m.location_id || null, work_item_id: m.work_item_id || null, request_id: m.request_id || null, kind: m.kind, memo: m.memo || null, storage_path: path, taken_at: new Date((f as any).lastModified || Date.now()).toISOString(), lat: gps?.lat, lng: gps?.lng, uploaded_by: profile!.id }));
      }
      if (m.request_id) await q(sb.from('requests').update({ status: 'done', answer_note: `사진 ${files.length}장`, answered_at: new Date().toISOString() }).eq('id', m.request_id));
      toast(`${files.length}장 올렸습니다`); setFiles([]); setPreviews([]); setM({ ...m, memo: '', request_id: '' }); load();
    } catch (e: any) { toast('올리기 실패: ' + e.message); }
    setBusy(false);
  };
  const facLocs = st?.facilities.flatMap((f) => f.locations.map((l) => ({ id: l.id, name: `${f.name} › ${l.name}` }))) || [];

  return (
    <>
      <h1 style={{ fontSize: 20 }}>사진 {report ? '' : ''}</h1>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button className="btn teal" style={{ height: 88, fontSize: 16 }} onClick={() => cam.current?.click()}>📷 사진 찍기</button>
        <button className="btn" style={{ height: 88, fontSize: 16, fontWeight: 700 }} onClick={() => alb.current?.click()}>앨범에서 고르기</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <input ref={alb} type="file" accept="image/*" multiple hidden onChange={(e) => { pick(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>
      {files.length > 0 && <section className="fcard">
        <h2>{files.length}장 등록</h2>
        <div className="row" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>{previews.map((u, i) => <div key={u} style={{ position: 'relative', flex: 'none' }}><img src={u} alt="" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8 }} />
          <button aria-label="빼기" onClick={() => { setFiles(files.filter((_, j) => j !== i)); setPreviews(previews.filter((_, j) => j !== i)); }} style={{ position: 'absolute', top: 2, right: 2, width: 26, height: 26, borderRadius: 13, border: 0, background: 'rgba(0,0,0,.6)', color: '#fff' }}>✕</button></div>)}</div>
        {gps && <span className="muted">GPS 기록됨 · {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>}
        <div className="field"><label htmlFor="pl">시설물 › 위치</label><select id="pl" className="input" value={m.location_id} onChange={(e) => setM({ ...m, location_id: e.target.value })}><option value="">선택 안 함</option>{facLocs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="field"><label htmlFor="pw">공종</label><select id="pw" className="input" value={m.work_item_id} onChange={(e) => setM({ ...m, work_item_id: e.target.value })}><option value="">선택 안 함</option>{st?.works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>구분</span>
        <div className="chips">{PHOTO_KINDS.map((k) => <button key={k} className={m.kind === k ? 'on' : ''} aria-pressed={m.kind === k} onClick={() => setM({ ...m, kind: k })}>{k}</button>)}</div>
        <div className="field"><label htmlFor="pm">메모 (선택)</label><input id="pm" className="input" value={m.memo} onChange={(e) => setM({ ...m, memo: e.target.value })} /></div>
        {reqs.length > 0 && <div className="field"><label htmlFor="pr">본사 요청에 응답</label><select id="pr" className="input" value={m.request_id} onChange={(e) => setM({ ...m, request_id: e.target.value })}><option value="">응답 안 함</option>{reqs.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>}
        <button className="btn teal block" disabled={busy} onClick={send}>{busy ? '올리는 중…' : `${files.length}장 올리기`}</button>
      </section>}
      <section className="fcard"><h2>오늘 올린 사진 {list.length}</h2>
        <div className="photo-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>{list.map((p) => <a key={p.id} className="photo" href={urls[p.storage_path]} target="_blank" rel="noreferrer">{urls[p.storage_path] && <img src={urls[p.storage_path]} alt={p.memo || p.kind} />}<span className="tag pill">{p.kind}</span></a>)}</div>
        {!list.length && <span className="sub">아직 없습니다. 위치별 사진 1장 이상을 권장합니다.</span>}
        {list[0] && <span className="muted">마지막 업로드 {dt(list[0].created_at)}</span>}
      </section>
    </>
  );
}
