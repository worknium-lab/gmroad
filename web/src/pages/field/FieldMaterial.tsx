import { useEffect, useRef, useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { upload } from '../../lib/files';
import { useAuth } from '../../lib/auth';
import { useField } from './FieldShell';
import { qty, today } from '../../lib/format';
import { useToast } from '../../lib/ui';

export default function FieldMaterial() {
  const { profile } = useAuth();
  const { pid, ensureReport } = useField();
  const toast = useToast();
  const [ledger, setLedger] = useState<any[]>([]);
  const [f, setF] = useState({ material_id: '', qty: '', vendor: '' });
  const [photo, setPhoto] = useState<File | null>(null); const [inv, setInv] = useState<File | null>(null);
  const [uses, setUses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const r1 = useRef<HTMLInputElement>(null); const r2 = useRef<HTMLInputElement>(null);
  const load = async () => { const l = await q<any[]>(sb.from('v_material_ledger').select('*').eq('project_id', pid).order('name')); setLedger(l); if (!f.material_id && l[0]) setF((x) => ({ ...x, material_id: l[0].material_id })); };
  useEffect(() => { load().catch((e) => toast(e.message)); }, [pid]);

  const saveIn = async () => {
    if (!f.material_id || !Number(f.qty)) return toast('자재와 수량을 넣어 주세요');
    setBusy(true);
    try {
      const r = await ensureReport();
      const p1 = photo ? (await upload(pid, 'materials', photo, photo.name, true)).path : null;
      const p2 = inv ? (await upload(pid, 'materials', inv, inv.name, true)).path : null;
      await q(sb.from('material_moves').insert({ project_id: pid, material_id: f.material_id, report_id: r.id, move_date: today(), kind: 'in', qty: Number(f.qty), vendor: f.vendor || null, photo_path: p1, invoice_path: p2, entered_by: profile!.id }));
      toast('반입을 등록했습니다'); setF({ ...f, qty: '' }); setPhoto(null); setInv(null); load();
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  const saveUse = async () => {
    const rows = Object.entries(uses).filter(([, v]) => Number(v) > 0);
    if (!rows.length) return;
    setBusy(true);
    try {
      const r = await ensureReport();
      await q(sb.from('material_moves').insert(rows.map(([id, v]) => ({ project_id: pid, material_id: id, report_id: r.id, move_date: today(), kind: 'use', qty: Number(v), entered_by: profile!.id }))));
      toast('사용량을 저장했습니다'); setUses({}); load();
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  if (!ledger.length) return <div className="empty">본사에서 이 현장의 자재를 아직 등록하지 않았습니다.</div>;
  const cur = ledger.find((m) => m.material_id === f.material_id);
  return (
    <>
      <h1 style={{ fontSize: 20 }}>자재반입 · 사용</h1>
      <section className="fcard"><h2>반입 등록</h2>
        <div className="field"><label htmlFor="mn">자재명 (규격)</label><select id="mn" className="input" value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })}>{ledger.map((m) => <option key={m.material_id} value={m.material_id}>{m.name}{m.spec ? ` (${m.spec})` : ''}</option>)}</select></div>
        <div className="row" style={{ flexWrap: 'nowrap' }}><div className="field" style={{ flex: 1 }}><label htmlFor="mq">반입 수량</label><input id="mq" className="input" type="number" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div><span className="sub" style={{ marginTop: 24 }}>{cur?.unit}</span></div>
        <div className="field"><label htmlFor="mv">납품업체</label><input id="mv" className="input" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button className="btn" style={{ height: 64 }} onClick={() => r1.current?.click()}>{photo ? '반입 사진 ✓' : '반입 사진'}</button>
          <button className="btn" style={{ height: 64 }} onClick={() => r2.current?.click()}>{inv ? '송장 사진 ✓' : '송장 사진'}</button>
          <input ref={r1} hidden type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          <input ref={r2} hidden type="file" accept="image/*" capture="environment" onChange={(e) => setInv(e.target.files?.[0] || null)} />
        </div>
        <button className="btn teal" disabled={busy} onClick={saveIn}>반입 저장</button>
      </section>
      <section className="fcard"><h2>금일 사용 (현장 재고가 있는 자재)</h2>
        {ledger.filter((m) => Number(m.stock_qty) > 0).map((m) => (
          <div key={m.material_id} className="row" style={{ flexWrap: 'nowrap', borderTop: '1px solid var(--line-2)', paddingTop: 8 }}>
            <label htmlFor={'u' + m.material_id} style={{ flex: 1 }}><b>{m.name}</b><div className="muted">재고 {qty(m.stock_qty)} {m.unit}</div></label>
            <input id={'u' + m.material_id} className="qty-in" style={{ width: 90 }} type="number" inputMode="decimal" value={uses[m.material_id] || ''} onChange={(e) => setUses({ ...uses, [m.material_id]: e.target.value })} />
          </div>))}
        {!ledger.some((m) => Number(m.stock_qty) > 0) && <span className="sub">재고가 있는 자재가 없습니다.</span>}
        <button className="btn teal" disabled={busy} onClick={saveUse}>사용량 저장</button>
      </section>
    </>
  );
}
