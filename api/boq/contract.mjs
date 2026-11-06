// 도급내역서 만들기
//  1) 원가계산서에서 '고정' 체크한 줄은 설계 금액을 값으로 박음 (낙찰률 영향 없음)
//  2) 공종 단가(재료비 · 노무비 · 경비)에 낙찰률을 곱하고 원 미만 버림 → 값으로 바꿈
//     (낙찰 제외로 고른 묶음 · 공종은 그대로)
//  3) 도급액이 계약금액과 같아지도록 이윤 칸 수식 끝에 '- 조정액'을 붙임 (원본 수식은 살림)
//  4) 원본 엑셀에 바뀐 셀만 써서 새 파일을 만듦
import { readWorkbook, patchWorkbook } from './xlsx.mjs';
import { Evaluator } from './evaluator.mjs';
import { parseBoq } from './detect.mjs';

const clean = (x) => Number(x.toPrecision(15));

export async function buildContract(buf, opt) {
  const { sheet, headerRow, rate, fixedRows = [], noRateRows = [], target } = opt;
  if (!(rate > 0 && rate <= 1.5)) throw new Error('낙찰률이 이상합니다');
  const model = await readWorkbook(buf);
  const ev = new Evaluator(model);
  const before = parseBoq(model, ev, sheet, headerRow);
  const { cm, items, totals } = before;
  const byRow = new Map(items.map((i) => [i.row, i]));
  const excluded = (it) => { let x = it; for (let d = 0; x && d < 30; d++) { if (noRateRows.includes(x.row)) return true; x = byRow.get(x.parent_row); } return false; };
  const edits = {};
  const put = (a, e) => { edits[a] = e; ev.set(sheet, a, e.formula ? { f: e.formula } : { v: e.value }); };

  // 1) 고정 줄: 설계 계산값을 그대로 값으로
  const fixedVals = [];
  for (const r of fixedRows) {
    for (const k of ['mat', 'lab', 'exp']) {
      const a = cm[k + 'Amt'] + r;
      if (ev.formula(sheet, a)) fixedVals.push([a, ev.num(sheet, a)]);
    }
  }
  const designContract = totals.contract ? ev.num(sheet, cm.totalAmt + totals.contract.row) : null;
  const designProfit = totals.profit ? byRow.get(totals.profit.row).total_amt : null;
  for (const [a, v] of fixedVals) put(a, { value: v });

  // 2) 낙찰률
  let changed = 0;
  for (const it of items) {
    if (it.section !== 'detail' || excluded(it)) continue;
    if (it.kind === 'item') {
      for (const k of ['mat', 'lab', 'exp']) {
        const a = cm[k + 'Price'] + it.row; const v = ev.num(sheet, a);
        if (!v) continue;
        put(a, { value: Math.trunc(clean(v * rate)) }); changed++;
      }
    } else if (it.kind === 'cost') {
      // 상세부의 값으로 된 금액(야간노임할증 등)은 금액에 낙찰률. 수식이면(조달수수료 등) 그대로 둠
      for (const k of ['mat', 'lab', 'exp']) {
        const a = cm[k + 'Amt'] + it.row;
        if (ev.formula(sheet, a)) continue;
        const v = ev.num(sheet, a); if (!v) continue;
        put(a, { value: Math.trunc(clean(v * rate)) }); changed++;
      }
    }
  }

  // 3) 계약금액 맞춤 (이윤 조정)
  const contractAddr = totals.contract ? cm.totalAmt + totals.contract.row : null;
  let profitAddr = null, profitF = null, adj = 0, reached = null, residual = null;
  const afterRate = contractAddr ? ev.num(sheet, contractAddr) : null;
  if (target && contractAddr && totals.profit) {
    for (const k of ['exp', 'lab', 'mat']) { const a = cm[k + 'Amt'] + totals.profit.row; const fx = ev.formula(sheet, a); if (fx) { profitAddr = a; profitF = fx; break; } }
    if (!profitAddr) throw new Error('이윤 줄에 수식이 없어 계약금액을 맞출 수 없습니다');
    const tryAdj = (x) => { ev.set(sheet, profitAddr, { f: x ? `(${profitF})-(${x})` : profitF }); return ev.num(sheet, contractAddr); };
    let cur = tryAdj(0), best = { adj: 0, d: cur - target };
    for (let i = 0; i < 40 && cur !== target; i++) {
      const step = Math.trunc((cur - target) / 1.1) || Math.sign(cur - target);
      adj += step; cur = tryAdj(adj);
      if (Math.abs(cur - target) < Math.abs(best.d) || (Math.abs(cur - target) === Math.abs(best.d) && cur <= target)) best = { adj, d: cur - target };
    }
    if (cur !== target) { for (let x = best.adj - 3; x <= best.adj + 3; x++) { const c = tryAdj(x); if (c === target || Math.abs(c - target) < Math.abs(best.d)) best = { adj: x, d: c - target }; } }
    adj = best.adj; reached = tryAdj(adj); residual = reached - target;
    if (adj) edits[profitAddr] = { formula: `(${profitF})-(${adj})` }; else delete edits[profitAddr];
  }

  // 4) 제목을 '도급내역서'로 (A1이 '내역서'류일 때만)
  const title = model.sheet(sheet).cells.get('A1')?.v;
  if (typeof title === 'string' && /내\s*역\s*서/.test(title) && !/도\s*급/.test(title)) edits['A1'] = { value: '도 급 내 역 서' };

  const after = parseBoq(model, ev, sheet, headerRow);
  const profitRow = after.items.find((x) => x.row === totals.profit?.row);
  const net = after.items.find((x) => x.row === totals.net?.row);
  const oh = after.items.find((x) => x.row === totals.overhead?.row);
  const profitBase = net && oh ? net.lab_amt + net.exp_amt + oh.total_amt : null;
  const result = {
    rate, changedCells: changed, fixedCells: fixedVals.length,
    designContract, afterRate, target: target || null, reached, residual, profitAdjust: adj,
    designProfit, profit: profitRow?.total_amt ?? null,
    profitRate: profitBase ? Math.round((profitRow.total_amt / profitBase) * 10000) / 100 : null,
  };
  return { edits: { [sheet]: edits }, before, after, result, makeFile: () => patchWorkbook(buf, { [sheet]: edits }, changedValues(model, ev)) };
}

/** 수식 셀 중 계산값이 원본 저장값과 달라진 것만 모음 (모든 시트) */
export function changedValues(model, ev) {
  const out = {};
  for (const s of model.sheets) {
    const m = {};
    const addrs = new Set([...s.cells.keys()]);
    for (const k of ev.over.keys()) if (k.startsWith(s.name + '!')) addrs.add(k.slice(s.name.length + 1));
    for (const a of addrs) {
      if (!ev.formula(s.name, a)) continue;
      const v = ev.value(s.name, a); const old = s.cells.get(a)?.v;
      const same = typeof v === 'number' && typeof old === 'number' ? Math.abs(v - old) < 1e-9 : v === old;
      if (!same) m[a] = typeof v === 'number' ? Number(v.toPrecision(15)) : v;
    }
    if (Object.keys(m).length) out[s.name] = m;
  }
  return out;
}
