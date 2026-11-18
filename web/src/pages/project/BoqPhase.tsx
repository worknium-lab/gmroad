// ④ 내역서 › 차수 — 장기계속공사의 연차별 계약 금액 만들기 (도급 · 준공내역서 수량을 차수별로 나눔)
//   계산: 적산 엔진 splitByRatio(마지막 차수가 끝수) · phaseSheet · unassigned
import { useEffect, useMemo, useState } from 'react';
import { q, sb } from '../../lib/supabase';
import { won, qty as fq } from '../../lib/format';
import { useLoad, useToast, Loading, ErrorBox } from '../../lib/ui';
import { toSheet } from '../../lib/boqSheet';
import { moveAll, phaseTotals, q3, rowsOf, splitRatio, toAlloc, total, unassignedOf, type QtyMap } from '../../lib/boqProgress';
import { lineAmount, phaseSheet, flatten, costSheet } from '../../lib/estimate';
import { inferRates } from '../../lib/boqCost';
import { costXSheet, downloadXlsx, phaseXSheet } from '../../lib/boqXlsx';
import { fetchItems } from './BoqChange';

const nospace = (s: string) => (s || '').replace(/\s+/g, '');

/** 수량 입력칸: 입력 중에는 글자 그대로, 칸을 벗어날 때 숫자로 */
export function QtyInput({ value, onCommit, over, disabled, label }: { value: number; onCommit: (v: number) => void; over?: boolean; disabled?: boolean; label: string }) {
  const [s, setS] = useState(value ? String(value) : '');
  useEffect(() => { setS(value ? String(value) : ''); }, [value]);
  if (disabled) return <span className="num">{value ? fq(value) : ''}</span>;
  return (
    <input className={'qin' + (over ? ' over' : '')} inputMode="decimal" aria-label={label} value={s}
      onChange={(e) => setS(e.target.value.replace(/[^\d.]/g, ''))}
      onBlur={() => { const v = q3(Number(s || 0)); if (v !== value) onCommit(v); else setS(value ? String(value) : ''); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export default function BoqPhase({ base, canEdit }: { base: any; canEdit: boolean }) {
  const toast = useToast();
  const items = useLoad(() => fetchItems(base.id), [base.id]);
  const phases = useLoad(() => q<any[]>(sb.from('boq_phases').select('*').eq('revision_id', base.id).order('seq')), [base.id]);
  const [maps, setMaps] = useState<QtyMap[] | null>(null);
  const [ratio, setRatio] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [find, setFind] = useState('');
  const [onlyUn, setOnlyUn] = useState(false);
  const [to, setTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const sheet = useMemo(() => (items.data ? toSheet(items.data) : null), [items.data]);
  const inf = useMemo(() => (sheet && items.data ? inferRates(items.data, total(sheet)) : null), [sheet, items.data]);
  const saved: QtyMap[] = useMemo(() => (phases.data || []).map((p) => p.alloc || {}), [phases.data]);
  const cur = maps ?? saved;
  const dirty = maps !== null;

  if (items.loading || phases.loading) return <Loading />;
  if (items.error || phases.error) return <ErrorBox msg={items.error || phases.error || ''} />;
  if (!sheet || !inf) return null;
  const list = phases.data || [];

  const addPhase = async () => {
    try {
      const n = list.length + 1;
      await q(sb.from('boq_phases').insert({ project_id: base.project_id, revision_id: base.id, seq: n, name: `${n}차`, alloc: {} }));
      await phases.reload(); toast(`${n}차를 만들었습니다`);
    } catch (e: any) { toast(e.message); }
  };
  if (!list.length) {
    return (
      <section className="card">
        <h2>차수</h2>
        <span className="sub">장기계속공사처럼 해마다 따로 계약할 때 씁니다. ‘{base.title}’ 수량을 차수별로 나누고, 차수마다 금액을 냅니다. 한 번에 계약하는 공사는 쓰지 않아도 됩니다.</span>
        {canEdit && <div className="row"><button className="btn pri" onClick={async () => { await addPhase(); }}>1차 만들기</button></div>}
      </section>
    );
  }

  const tots = phaseTotals(sheet, cur);
  // 차수별 계약 금액: 차수 직접공사비로 원가계산서를 다시 계산 (요율은 기준 내역서 원가계산서에서 읽음)
  const contract = Number(base.totals?.contract || 0);
  const useCost = Math.abs(inf.calc.total - contract) < 1;
  const costs = tots.map((t) => costSheet({ direct: t, rates: inf.rates, exclude: inf.exclude }));
  const excel = async () => {
    setBusy(true);
    try {
      const sub = `기준 ${base.title} · 도급액 ${won(contract)}원`;
      const sheets = [phaseXSheet({ title: '차수별 내역서', sub, lines: sheet.sections[0].lines, names: list.map((p) => p.name), qty: (i, id) => Number(cur[i]?.[id] || 0) })];
      if (useCost) sheets.push(costXSheet('차수별 원가계산서', sub + ' · 요율: 기준 내역서 원가계산서', list.map((p, i) => [p.name, costs[i]])));
      await downloadXlsx(base.project_id, '차수별_내역서', sheets);
    } catch (e: any) { toast('엑셀 만들기 실패: ' + e.message); }
    setBusy(false);
  };
  const all = total(sheet);
  const un = unassignedOf(sheet, cur);
  const alloc = toAlloc(cur);
  // 공종 줄의 차수별 금액
  const gAmt = list.map((_, i) => new Map(flatten(phaseSheet(sheet, alloc, i).sections[0].lines).map((r) => [r.line.id, r.amount.t])));
  const rows = rowsOf(sheet);
  const byId = new Map(rows.map((r) => [r.line.id, r]));
  const visible = onlyUn
    ? rows.filter((r) => !r.line.children && un.rest[r.line.id])
    : find.trim()
    ? rows.filter((r) => !r.line.children && (nospace(r.line.name) + nospace(r.line.spec)).includes(nospace(find)))
    : rows.filter((r) => r.ancestors.every((a) => open[a] ?? (byId.get(a)?.depth === 0)));
  const setQty = (i: number, id: string, v: number) => { const n = cur.map((m) => ({ ...m })); if (v) n[i][id] = v; else delete n[i][id]; setMaps(n); };
  const toggleSel = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const ratios = list.map((_, i) => Number(ratio[i] || 0) / 100);
  const ratioOk = Math.abs(ratios.reduce((a, b) => a + b, 0) - 1) < 1e-6;
  const applyRatio = (only: boolean) => {
    if (!ratioOk) { toast('비율 합이 100%가 되게 넣어 주세요'); return; }
    if (only && !sel.size) { toast('나눌 공종을 먼저 체크하세요'); return; }
    setMaps(splitRatio(sheet, cur, ratios, only ? sel : undefined)); toast('나눴습니다. 저장을 눌러야 남습니다');
  };
  const save = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < list.length; i++) await q(sb.from('boq_phases').update({ alloc: cur[i] }).eq('id', list[i].id));
      setMaps(null); await phases.reload(); toast('저장했습니다');
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  };
  const rename = async (p: any) => {
    const name = window.prompt('차수 이름 (예: 1차 (2026년))', p.name);
    if (!name || name === p.name) return;
    try { await q(sb.from('boq_phases').update({ name }).eq('id', p.id)); phases.reload(); } catch (e: any) { toast(e.message); }
  };
  const removeLast = async () => {
    const p = list[list.length - 1];
    if (!window.confirm(`'${p.name}'을(를) 지울까요? 이 차수에 넣은 수량은 미배정으로 돌아갑니다.`)) return;
    try { await q(sb.from('boq_phases').delete().eq('id', p.id)); setMaps(null); phases.reload(); } catch (e: any) { toast(e.message); }
  };

  return (
    <>
      <div className="grid g4">
        <div className="stat"><span className="l">나눌 직접공사비</span><span className="v">{won(all.t)}</span><span className="s">기준: {base.title}</span></div>
        {list.map((p, i) => <div key={p.id} className="stat"><span className="l">{p.name} {useCost ? '계약 금액' : '직접공사비'}</span><span className="v">{won(useCost ? costs[i].total : tots[i].t)}</span><span className="s">{useCost ? `직접공사비 ${won(tots[i].t)} · ` : ''}{all.t ? ((tots[i].t / all.t) * 100).toFixed(1) : 0}%</span></div>)}
        <div className="stat" style={un.amt ? { borderColor: 'var(--red)' } : undefined}><span className="l">미배정</span><span className="v" style={{ color: un.amt ? 'var(--red)' : undefined }}>{won(un.amt)}</span><span className="s">{Object.keys(un.rest).length}개 항목</span></div>
      </div>
      {un.amt !== 0
        ? <div className="banner red">아직 차수에 넣지 않은 수량이 {Object.keys(un.rest).length}개 항목에 있습니다. 미배정이 0이어야 차수 합이 도급 수량과 맞습니다.</div>
        : <div className="banner teal">모든 항목 수량을 차수에 다 나눴습니다. 차수 합 = 도급 수량.</div>}
      {useCost ? <div className="muted">차수 계약 금액 = 차수 직접공사비로 다시 계산한 원가계산서 (요율은 ‘{base.title}’ 원가계산서에서 읽음). 차수 합은 끝수 때문에 도급액과 몇 원 다를 수 있습니다 (합 {won(costs.reduce((a, c) => a + c.total, 0))} / 도급액 {won(contract)}).</div>
        : <div className="muted">원가계산서 요율로 도급액을 다시 만들지 못해 직접공사비만 보여 줍니다.</div>}
      <div className="row"><button className="btn" disabled={busy} onClick={excel}>엑셀 내려받기</button></div>
      {dirty && <div className="banner"><span style={{ flex: 1 }}>바꾼 내용이 아직 저장되지 않았습니다.</span><button className="btn sm" onClick={() => setMaps(null)}>되돌리기</button><button className="btn sm pri" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button></div>}

      <section className="card flat">
        {canEdit && <div className="card-h" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-2)' }}>
          <div className="row">
            <span className="muted">비율</span>
            {list.map((p, i) => <label key={p.id} className="row" style={{ gap: 4 }}><span className="muted">{p.name}</span>
              <input className="qin" style={{ width: 64 }} inputMode="decimal" aria-label={`${p.name} 비율`} value={ratio[i] || ''} onChange={(e) => { const n = [...ratio]; n[i] = e.target.value.replace(/[^\d.]/g, ''); setRatio(n); }} />%</label>)}
            <button className="btn sm" onClick={() => applyRatio(true)}>고른 공종에 적용</button>
            <button className="btn sm" onClick={() => applyRatio(false)}>전체에 적용</button>
          </div>
          <div className="row">
            <span className="muted">고른 것을</span>
            <select className="input" style={{ width: 120, height: 36 }} value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="옮길 차수">{list.map((p, i) => <option key={p.id} value={i}>{p.name}</option>)}</select>
            <button className="btn sm" onClick={() => { if (!sel.size) { toast('옮길 공종을 먼저 체크하세요'); return; } setMaps(moveAll(sheet, cur, to, sel)); }}>에 통째로</button>
            <button className="btn sm" onClick={addPhase}>+ 차수</button>
            {list.length > 1 && <button className="btn sm" onClick={removeLast}>마지막 차수 지우기</button>}
          </div>
        </div>}
        <div className="card-h" style={{ padding: '10px 14px' }}>
          <div className="row">{!find && <><button className="btn sm" onClick={() => setOpen(Object.fromEntries(rows.filter((r) => r.line.children).map((r) => [r.line.id, true])))}>모두 펼치기</button><button className="btn sm" onClick={() => setOpen({})}>접기</button></>}
            {(Object.keys(un.rest).length > 0 || onlyUn) && <button className={'btn sm' + (onlyUn ? ' pri' : '')} aria-pressed={onlyUn} onClick={() => setOnlyUn(!onlyUn)}>미배정 {Object.keys(un.rest).length}개만 보기</button>}</div>
          <input className="input" style={{ width: 200 }} placeholder="공종 찾기" value={find} onChange={(e) => setFind(e.target.value)} aria-label="공종 찾기" />
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{canEdit && <th></th>}<th>공종명</th><th className="c">단위</th><th className="r">합계 단가</th><th className="r">도급 수량</th>
              {list.map((p) => <th key={p.id} className="r"><button className="link" onClick={() => canEdit && rename(p)} title={canEdit ? '이름 바꾸기' : undefined}>{p.name}</button></th>)}
              <th className="r">미배정</th></tr></thead>
            <tbody>
              {visible.map((r) => {
                const l = r.line; const g = !!l.children; const u = un.rest[l.id] || 0;
                return (
                  <tr key={l.id} className={g ? 'click' : ''} style={g ? { fontWeight: 600, background: r.depth === 0 ? 'var(--head)' : undefined } : undefined}
                    onClick={g && !find && !onlyUn ? () => setOpen({ ...open, [l.id]: !(open[l.id] ?? r.depth === 0) }) : undefined}>
                    {canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(l.id)} onChange={() => toggleSel(l.id)} aria-label={l.name + ' 고르기'} style={{ width: 18, height: 18 }} /></td>}
                    <td style={{ paddingLeft: 12 + (onlyUn ? 0 : r.depth * 16) }}>{g && !find ? ((open[l.id] ?? r.depth === 0) ? '▾ ' : '▸ ') : ''}{l.name}{l.spec && !g ? <span className="muted"> · {l.spec}</span> : null}</td>
                    <td className="c">{g ? '' : l.unit}</td>
                    <td className="r">{g ? '' : won(l.mu + l.lu + l.eu)}</td>
                    <td className="r">{g ? won(lineAmount(l).t) : fq(l.qty)}</td>
                    {list.map((p, i) => <td key={p.id} className="r">{g ? won(gAmt[i].get(l.id) || 0) : <QtyInput value={Number(cur[i]?.[l.id] || 0)} disabled={!canEdit} label={`${l.name} ${p.name} 수량`} onCommit={(v) => setQty(i, l.id, v)} />}</td>)}
                    <td className="r" style={{ color: u ? 'var(--red)' : 'var(--sub)', fontWeight: u ? 700 : 400 }}>{g ? '' : u ? fq(q3(u)) : '0'}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={6 + list.length} className="sub">찾는 공종이 없습니다.</td></tr>}
            </tbody>
            <tfoot><tr>{canEdit && <td></td>}<td>직접공사비</td><td></td><td></td><td className="r">{won(all.t)}</td>{tots.map((t, i) => <td key={i} className="r">{won(t.t)}</td>)}<td className="r" style={{ color: un.amt ? 'var(--red)' : undefined }}>{won(un.amt)}</td></tr></tfoot>
          </table>
        </div>
        <div className="muted" style={{ padding: '8px 14px 12px' }}>수량 칸을 고치면 바로 다시 계산됩니다. 비율로 나누면 마지막 차수가 끝수를 받습니다. 공종 줄의 차수 칸은 그 차수 금액입니다 (원 미만 버림).</div>
      </section>
    </>
  );
}
