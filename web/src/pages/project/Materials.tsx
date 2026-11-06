import { useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { qty, dateK } from '../../lib/format';
import { useLoad, Loading, Empty, useSigned, useToast } from '../../lib/ui';

export default function Materials({ pid }: { pid: string }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [nf, setNf] = useState({ name: '', spec: '', unit: '포', design_qty: '' });
  const { data, loading, reload } = useLoad(async () => {
    const [ledger, moves] = await Promise.all([
      q<any[]>(sb.from('v_material_ledger').select('*').eq('project_id', pid).order('name')),
      q<any[]>(sb.from('material_moves').select('*').eq('project_id', pid).order('move_date', { ascending: false })),
    ]);
    return { ledger, moves };
  }, [pid]);
  const cur = data?.ledger.find((m) => m.material_id === sel) || data?.ledger[0];
  const curMoves = (data?.moves || []).filter((m) => m.material_id === cur?.material_id);
  const urls = useSigned(curMoves.flatMap((m) => [m.photo_path, m.invoice_path]));
  if (loading || !data) return <Loading />;

  const addMat = async () => {
    if (!nf.name.trim()) return;
    try { await q(sb.from('materials').insert({ project_id: pid, name: nf.name.trim(), spec: nf.spec || null, unit: nf.unit || '개', design_qty: Number(nf.design_qty) || 0 })); setNf({ ...nf, name: '', spec: '', design_qty: '' }); reload(); } catch (e: any) { toast(e.message); }
  };
  const byDay = new Map<string, { in: number; use: number; inv: string | null; ph: string | null }>();
  [...curMoves].reverse().forEach((m) => { const d = byDay.get(m.move_date) || { in: 0, use: 0, inv: null, ph: null }; d[m.kind as 'in' | 'use'] += Number(m.qty); d.inv = d.inv || m.invoice_path; d.ph = d.ph || m.photo_path; byDay.set(m.move_date, d); });
  let stock = 0; const days = [...byDay.entries()].map(([date, d]) => { stock += d.in - d.use; return { date, ...d, stock }; }).reverse();

  return (
    <>
      {canEdit && <section className="card"><div className="card-h"><h2>자재 등록</h2><span className="muted">현장 앱의 자재 선택지가 됩니다 (내역서 연결 전까지 직접 등록)</span></div>
        <div className="row"><input aria-label="자재명" className="input" style={{ width: 220 }} placeholder="자재명" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} />
          <input aria-label="규격" className="input" style={{ width: 160 }} placeholder="규격" value={nf.spec} onChange={(e) => setNf({ ...nf, spec: e.target.value })} />
          <input aria-label="단위" className="input" style={{ width: 80 }} value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })} />
          <input aria-label="설계수량" className="input num" style={{ width: 120 }} placeholder="설계수량" value={nf.design_qty} onChange={(e) => setNf({ ...nf, design_qty: e.target.value })} />
          <button className="btn pri sm" onClick={addMat}>+ 자재</button></div></section>}
      {!data.ledger.length ? <Empty>등록된 자재가 없습니다.</Empty> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)', alignItems: 'start' }}>
          <nav className="card" aria-label="자재 목록" style={{ padding: 10, gap: 4 }}>
            {data.ledger.map((m) => <button key={m.material_id} aria-pressed={cur?.material_id === m.material_id} onClick={() => setSel(m.material_id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, textAlign: 'left', cursor: 'pointer', border: cur?.material_id === m.material_id ? '1.5px solid var(--blue)' : '1px solid transparent', background: cur?.material_id === m.material_id ? 'var(--blue-ll)' : '#fff' }}>
              <span style={{ flex: 1 }}><b>{m.name}</b><div className="muted">{m.spec} · 반입 {qty(m.in_qty)} · 사용 {qty(m.use_qty)}</div></span>
              <span style={{ textAlign: 'right' }}><span className="muted">재고</span><div><b>{qty(m.stock_qty)}</b> {m.unit}</div></span></button>)}
          </nav>
          {cur && <section className="card">
            <div className="card-h"><h2>{cur.name} · 일자별 수불</h2><span className="muted">설계수량 {qty(cur.design_qty)} {cur.unit}</span></div>
            <div className="grid g4" style={{ gap: 10 }}>
              <div className="stat"><span className="l">반입누계</span><span className="v" style={{ fontSize: 20 }}>{qty(cur.in_qty)}</span></div>
              <div className="stat"><span className="l">사용누계 (현장 입력)</span><span className="v" style={{ fontSize: 20 }}>{qty(cur.use_qty)}</span></div>
              <div className="stat" style={{ background: 'var(--blue-l)' }}><span className="l">재고</span><span className="v" style={{ fontSize: 20 }}>{qty(cur.stock_qty)}</span></div>
              <div className="stat"><span className="l">설계 대비 반입</span><span className="v" style={{ fontSize: 20 }}>{cur.design_qty ? Math.round((cur.in_qty / cur.design_qty) * 100) + '%' : '-'}</span></div>
            </div>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>일자</th><th className="r">반입</th><th className="r">사용</th><th className="r">재고</th><th>증빙</th></tr></thead>
              <tbody>{days.map((d) => <tr key={d.date}><td>{dateK(d.date)}</td><td className="r">{d.in ? qty(d.in) : '-'}</td><td className="r">{d.use ? qty(d.use) : '-'}</td><td className="r"><b>{qty(d.stock)}</b></td>
                <td className="row" style={{ gap: 6 }}>{d.ph && urls[d.ph] && <a href={urls[d.ph]} target="_blank" rel="noreferrer">반입 사진</a>}{d.inv && urls[d.inv] && <a href={urls[d.inv]} target="_blank" rel="noreferrer">송장</a>}{!d.ph && !d.inv && '-'}</td></tr>)}</tbody></table></div>
            {!days.length && <span className="sub">아직 반입 · 사용 기록이 없습니다.</span>}
            <span className="muted">재고 = 반입누계 − 사용누계. 사용량은 현장에서 직접 입력합니다.</span>
          </section>}
        </div>)}
    </>
  );
}
