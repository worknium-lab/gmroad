import { useEffect, useMemo, useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { loadStructure, Structure } from '../../lib/data';
import { useField } from './FieldShell';
import { qty } from '../../lib/format';
import { useToast, Loading, Bar, Pill } from '../../lib/ui';

export default function FieldQty() {
  const { pid, report, ensureReport } = useField();
  const toast = useToast();
  const [st, setSt] = useState<Structure | null>(null);
  const [prog, setProg] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [fac, setFac] = useState(''); const [loc, setLoc] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const locked = report && ['submitted', 'confirmed'].includes(report.status);

  const load = async () => {
    const [s, p] = await Promise.all([loadStructure(pid), q<any[]>(sb.from('v_location_progress').select('*').eq('project_id', pid))]);
    setSt(s); setProg(p);
    if (!s.facilities.some((f) => f.id === fac)) { setFac(s.facilities[0]?.id || ''); setLoc(s.facilities[0]?.locations[0]?.id || ''); }
    setMine(report ? await q<any[]>(sb.from('progress_entries').select('*').eq('report_id', report.id)) : []);
  };
  useEffect(() => { load().catch((e) => toast(e.message)); }, [pid, report?.id]);
  useEffect(() => { const v: Record<string, string> = {}; mine.filter((m) => m.location_id === loc).forEach((m) => (v[m.work_item_id] = String(Number(m.qty)))); setVals(v); }, [loc, mine]);

  const works = useMemo(() => prog.filter((r) => r.location_id === loc).sort((a, b) => a.work_sort - b.work_sort), [prog, loc]);
  if (!st) return <Loading />;
  if (!st.facilities.length) return <div className="empty">본사에서 공사 구성(시설물 · 위치 · 공종)을 아직 정하지 않았습니다.</div>;
  const f = st.facilities.find((x) => x.id === fac);
  const locDone = (lid: string) => mine.some((m) => m.location_id === lid);

  const save = async (next: boolean) => {
    setBusy(true);
    try {
      const r = await ensureReport();
      for (const w of works) {
        const v = (vals[w.work_item_id] || '').trim();
        const ex = mine.find((m) => m.location_id === loc && m.work_item_id === w.work_item_id);
        if (ex && ex.status !== 'pending') continue;
        if (!v || Number(v) === 0) { if (ex) await q(sb.from('progress_entries').delete().eq('id', ex.id)); continue; }
        if (isNaN(Number(v)) || Number(v) < 0) throw new Error(`${w.work_name} 수량이 숫자가 아닙니다`);
        await q(sb.from('progress_entries').upsert({ report_id: r.id, project_id: pid, location_id: loc, work_item_id: w.work_item_id, qty: Number(v) }, { onConflict: 'report_id,location_id,work_item_id' }));
      }
      toast('저장했습니다');
      const all = await q<any[]>(sb.from('progress_entries').select('*').eq('report_id', r.id)); setMine(all);
      if (next && f) { const i = f.locations.findIndex((l) => l.id === loc); const nl = f.locations[i + 1]; if (nl) setLoc(nl.id); }
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };

  return (
    <>
      <h1 style={{ fontSize: 20 }}>공정률 수량 입력</h1>
      {locked && <div className="banner teal">제출한 일보라 수정할 수 없습니다.</div>}
      <div className="chips" role="group" aria-label="시설물">{st.facilities.map((x) => <button key={x.id} className={x.id === fac ? 'on' : ''} aria-pressed={x.id === fac} onClick={() => { setFac(x.id); setLoc(x.locations[0]?.id || ''); }}>{x.name}</button>)}</div>
      <div role="group" aria-label="위치" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
        {f?.locations.map((l) => <button key={l.id} aria-pressed={l.id === loc} onClick={() => setLoc(l.id)} className="btn" style={l.id === loc ? { background: 'var(--teal)', borderColor: 'var(--teal)', color: '#fff', fontWeight: 700 } : undefined}>{l.name}{locDone(l.id) ? ' ✓' : ''}</button>)}
      </div>
      <span className="sub">{f?.name} › {f?.locations.find((l) => l.id === loc)?.name} · 공종별 금일 수량</span>
      {!works.length && <div className="empty">이 위치에는 설계수량이 들어간 공종이 없습니다.</div>}
      {works.map((w) => { const ex = mine.find((m) => m.location_id === loc && m.work_item_id === w.work_item_id); const fixed = ex && ex.status !== 'pending'; const cum = Number(w.done_qty) + Number(w.pending_qty);
        const after = cum - Number(ex?.status === 'pending' ? ex.qty : 0) + Number(vals[w.work_item_id] || 0); const over = after > Number(w.design_qty); return (
        <div key={w.work_item_id} className="fcard">
          <div className="row between"><b style={{ fontSize: 15 }}>{w.work_name}</b><span className="muted">누계 {qty(cum)} / 설계 {qty(w.design_qty)} {w.unit}</span></div>
          <Bar teal v={(cum / Number(w.design_qty || 1)) * 100} />
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label htmlFor={'q' + w.work_item_id} className="sub" style={{ flex: 1 }}>금일{fixed && <> <Pill c="green">{ex.status === 'approved' ? '승인됨' : '반려'}</Pill></>}</label>
            <input id={'q' + w.work_item_id} className="qty-in" type="number" inputMode="decimal" min={0} step="any" value={vals[w.work_item_id] || ''} disabled={locked || fixed}
              onChange={(e) => setVals({ ...vals, [w.work_item_id]: e.target.value })} />
            <span style={{ width: 28 }} className="sub">{w.unit}</span>
          </div>
          {over && <span className="pill red" style={{ alignSelf: 'flex-start' }}>설계수량 초과 · 본사 검토로 올라갑니다</span>}
        </div>); })}
      {!locked && works.length > 0 && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button className="btn" style={{ height: 52, borderColor: 'var(--teal)', color: 'var(--teal)', fontWeight: 700 }} disabled={busy} onClick={() => save(true)}>저장 · 다음 위치</button>
        <button className="btn teal" style={{ height: 52 }} disabled={busy} onClick={() => save(false)}>저장</button></div>}
      <span className="muted">입력한 수량은 본사 승인 후 공정률에 반영됩니다.</span>
    </>
  );
}
