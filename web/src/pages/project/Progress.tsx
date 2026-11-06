import { useMemo, useState } from 'react';
import { sb, q } from '../../lib/supabase';
import { loadStructure } from '../../lib/data';
import { useAuth } from '../../lib/auth';
import { won, qty, dateK } from '../../lib/format';
import { useLoad, Loading, Bar, Empty, Pill, useToast } from '../../lib/ui';

const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export default function Progress({ pid, onChange }: { pid: string; onChange: () => void }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { data, loading, reload } = useLoad(async () => {
    const [rows, st, pending] = await Promise.all([
      q<any[]>(sb.from('v_location_progress').select('*').eq('project_id', pid)),
      loadStructure(pid),
      q<any[]>(sb.from('progress_entries').select('*, daily_reports(report_date), profiles!progress_entries_entered_by_fkey(name, username)').eq('project_id', pid).eq('status', 'pending').order('created_at')),
    ]);
    return { rows, st, pending };
  }, [pid]);

  const calc = useMemo(() => {
    if (!data) return null;
    const { rows, st } = data;
    const works = st.works.filter((w) => rows.some((r) => r.work_item_id === w.id));
    const cell = (fid: string | null, lid: string | null, wid: string | null) => {
      const rs = rows.filter((r) => (!fid || r.facility_id === fid) && (!lid || r.location_id === lid) && (!wid || r.work_item_id === wid));
      if (!rs.length) return null;
      const d = rs.reduce((s, r) => s + Number(r.design_amount), 0), x = rs.reduce((s, r) => s + Number(r.done_amount), 0);
      return { d, x, p: pctOf(x, d), dq: rs.reduce((s, r) => s + Number(r.design_qty), 0), xq: rs.reduce((s, r) => s + Number(r.done_qty), 0), pq: rs.reduce((s, r) => s + Number(r.pending_qty), 0) };
    };
    return { works, cell, total: cell(null, null, null) };
  }, [data]);

  const review = async (ids: string[], status: 'approved' | 'rejected') => {
    try { await q(sb.from('progress_entries').update({ status }).in('id', ids)); toast(status === 'approved' ? `${ids.length}건 승인` : '반려했습니다'); reload(); onChange(); } catch (e: any) { toast(e.message); }
  };
  if (loading || !data || !calc) return <Loading />;
  const { st, pending } = data;
  if (!data.rows.length) return <Empty>③ 공사 구성 탭에서 시설물 · 위치 · 공종과 위치별 설계수량을 먼저 넣어 주세요.</Empty>;
  const locName = (id: string) => { for (const f of st.facilities) { const l = f.locations.find((x) => x.id === id); if (l) return `${f.name} › ${l.name}`; } return ''; };
  const wName = (id: string) => st.works.find((w) => w.id === id);
  const show = (c: any) => (c ? <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}><span style={{ color: c.p >= 100 ? 'var(--green)' : undefined, fontWeight: c.p >= 100 ? 700 : 400 }}>{c.p === null ? '-' : c.p.toFixed(1) + '%'}</span><span style={{ width: 72 }}><Bar v={c.p || 0} /></span></span> : <span style={{ color: 'var(--muted)' }}>—</span>);
  const t = calc.total!;

  return (
    <>
      <div className="grid g4">
        <div className="stat" style={{ background: 'var(--blue-ll)', borderColor: 'var(--blue)' }}><span className="l">실적 공정률 (금액 기준)</span><span className="v">{t.p?.toFixed(1)}%</span><span className="s">승인된 입력만</span></div>
        <div className="stat"><span className="l">설계 금액 (공종 합계)</span><span className="v" style={{ fontSize: 20 }}>{won(t.d)}</span></div>
        <div className="stat"><span className="l">실적 금액</span><span className="v" style={{ fontSize: 20 }}>{won(t.x)}</span></div>
        <div className="stat" style={pending.length ? { background: 'var(--orange-l)', borderColor: 'var(--orange-b)' } : undefined}><span className="l">현장 입력 승인 대기</span><span className="v">{pending.length}건</span></div>
      </div>

      {pending.length > 0 && <section className="card">
        <div className="card-h"><h2>현장 입력 검토 대기</h2>{canEdit && <button className="btn teal sm" onClick={() => review(pending.map((p) => p.id), 'approved')}>모두 승인 ({pending.length})</button>}</div>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>일자</th><th>위치 · 공종</th><th className="r">금일</th><th className="r">승인 후 누계 / 설계</th><th>입력</th><th /></tr></thead>
          <tbody>{pending.map((p) => { const r = data.rows.find((x) => x.location_id === p.location_id && x.work_item_id === p.work_item_id); const after = Number(r?.done_qty || 0) + Number(p.qty); const over = r && after > Number(r.design_qty); return (
            <tr key={p.id}><td>{dateK(p.daily_reports?.report_date)}</td><td>{locName(p.location_id)} · <b>{wName(p.work_item_id)?.name}</b>{over && <> <Pill c="red">설계수량 초과</Pill></>}</td>
              <td className="r"><b>{qty(p.qty)}</b> {wName(p.work_item_id)?.unit}</td><td className="r">{qty(after)} / {qty(r?.design_qty)}</td><td className="muted">{p.profiles?.name || p.profiles?.username}</td>
              <td>{canEdit && <div className="row" style={{ flexWrap: 'nowrap' }}><button className="btn teal sm" onClick={() => review([p.id], 'approved')}>승인</button><button className="btn sm" onClick={() => review([p.id], 'rejected')}>반려</button></div>}</td></tr>); })}</tbody></table></div>
      </section>}

      <section className="card flat">
        <div className="card-h" style={{ padding: '16px 20px 0' }}><h2>시설물 × 공종 공정률</h2><span className="muted">시설물을 누르면 위치별로 펼쳐집니다</span></div>
        <div className="tbl-wrap" style={{ paddingTop: 10 }}><table className="tbl" style={{ minWidth: 760 }}>
          <thead><tr><th>시설물 › 위치</th>{calc.works.map((w) => <th key={w.id} className="r">{w.name}</th>)}<th className="r">합계</th></tr></thead>
          <tbody>{st.facilities.filter((f) => calc.cell(f.id, null, null)).map((f) => (
            [<tr key={f.id} style={{ background: '#FBFCFD' }}>
              <td><button className="link" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }} aria-expanded={!!open[f.id]} onClick={() => setOpen({ ...open, [f.id]: !open[f.id] })}>{open[f.id] ? '▾' : '▸'} {f.name}</button></td>
              {calc.works.map((w) => <td key={w.id} className="r">{show(calc.cell(f.id, null, w.id))}</td>)}<td className="r"><b>{calc.cell(f.id, null, null)?.p?.toFixed(1)}%</b></td></tr>,
            ...(open[f.id] ? f.locations.filter((l) => calc.cell(null, l.id, null)).map((l) => (
              <tr key={l.id}><td style={{ paddingLeft: 32 }} className="sub">└ {l.name}</td>{calc.works.map((w) => <td key={w.id} className="r">{show(calc.cell(null, l.id, w.id))}</td>)}<td className="r">{calc.cell(null, l.id, null)?.p?.toFixed(1)}%</td></tr>)) : [])]))}
          </tbody></table></div>
      </section>

      <section className="card flat">
        <div className="card-h" style={{ padding: '16px 20px 0' }}><h2>공종별 수량 누계</h2></div>
        <div className="tbl-wrap" style={{ paddingTop: 10 }}><table className="tbl" style={{ minWidth: 820 }}>
          <thead><tr><th>공종 · 규격</th><th>단위</th><th className="r">설계수량</th><th className="r">도급단가</th><th className="r">누계수량</th><th className="r">대기</th><th className="r">누계금액</th><th className="r">공정률</th></tr></thead>
          <tbody>{calc.works.map((w) => { const c = calc.cell(null, null, w.id)!; return (
            <tr key={w.id}><td><b>{w.name}</b> <span className="muted">{w.spec}</span></td><td>{w.unit}</td><td className="r">{qty(c.dq)}</td><td className="r">{won(w.unit_price)}</td><td className="r">{qty(c.xq)}</td>
              <td className="r" style={{ color: c.pq ? 'var(--orange-d)' : undefined }}>{c.pq ? qty(c.pq) : '-'}</td><td className="r">{won(c.x)}</td><td className="r"><b>{c.p?.toFixed(1)}%</b></td></tr>); })}</tbody>
          <tfoot><tr><td colSpan={6}>합계</td><td className="r">{won(t.x)}</td><td className="r">{t.p?.toFixed(1)}%</td></tr></tfoot>
        </table></div>
        <p className="muted" style={{ padding: '0 20px 16px', margin: 0 }}>공정률(금액 기준) = Σ TRUNC(누계수량 × 도급단가) ÷ Σ TRUNC(설계수량 × 도급단가). 현장 앱에서 들어온 수량은 승인해야 반영됩니다.</p>
      </section>
    </>
  );
}
