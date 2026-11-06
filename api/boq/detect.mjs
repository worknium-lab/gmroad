// 내역서 시트 인식 · 항목 트리 만들기
//  - 머리글(공종명 · 규격 · 수량 · 단위 · 재료비 · 노무비 · 경비 · 합계 · 비고)을 찾아 열 위치를 정함
//  - 각 행의 수식을 보고 종류를 나눔
//      item  : 금액 = TRUNC(단가 × 수량)  (단가는 일위대가 · 자재 등 다른 시트 참조 또는 값)
//      link  : 단가가 같은 시트의 다른 행 합계를 가리킴 (총괄표의 "1.신궁1육교 1식" 같은 줄)
//      group : 금액 = 아래 행들의 합 (소계)
//      cost  : 위 둘이 아닌 금액 (제경비 · 요율 · 조정금액)
//  - 소계 수식이 가리키는 행으로 부모-자식 관계를 만듦
import { colToNum, numToCol, addr } from './xlsx.mjs';

const norm = (s) => String(s ?? '').replace(/\s+/g, '');
const H = {
  name: /^(공종명|품명|공종|명칭|공종및규격|품명및규격)$/,
  spec: /^규격$/, qty: /^수량$/, unit: /^단위$/, note: /^비고$/,
  total: /^(합계|공사비|계)$/, mat: /^재료비$/, lab: /^노무비$/, exp: /^경비$/,
};

/** 시트마다 머리글을 찾아 내역서처럼 보이는 시트 후보를 돌려줌 (점수 높은 순) */
export function findBoqSheets(model) {
  const out = [];
  for (const s of model.sheets) {
    for (let r = 1; r <= 15; r++) {
      const row = {};
      for (let c = 1; c <= 40; c++) { const v = s.cells.get(addr(c, r))?.v; if (v != null) row[c] = norm(v); }
      const find = (re) => Object.entries(row).find(([, v]) => re.test(v))?.[0];
      const name = find(H.name), qty = find(H.qty), unit = find(H.unit), mat = find(H.mat), lab = find(H.lab), exp = find(H.exp);
      if (name && qty && unit && mat && lab && exp) {
        out.push({ sheet: s.name, headerRow: r, score: (/변경/.test(s.name) ? 0 : 10) + (/내역/.test(s.name) ? 5 : 0) + s.cells.size / 10000 });
        break;
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 머리글 두 줄(위: 재료비 · 노무비 · 경비, 아래: 단가 · 금액)에서 열 지도 만들기 */
export function columnMap(model, sheet, headerRow) {
  const s = model.sheet(sheet);
  const top = (c) => norm(s.cells.get(addr(c, headerRow))?.v);
  const sub = (c) => norm(s.cells.get(addr(c, headerRow + 1))?.v);
  const m = {};
  for (let c = 1; c <= 40; c++) {
    const t = top(c);
    for (const [k, re] of Object.entries(H)) if (re.test(t) && !m[k]) m[k] = c;
  }
  const pair = (c) => (c ? (/단가/.test(sub(c)) ? { price: c, amt: c + 1 } : /금액/.test(sub(c)) ? { price: c - 1, amt: c } : { price: c, amt: c + 1 }) : null);
  const cm = {
    name: numToCol(m.name), spec: m.spec ? numToCol(m.spec) : null, qty: numToCol(m.qty), unit: numToCol(m.unit), note: m.note ? numToCol(m.note) : null,
  };
  for (const k of ['total', 'mat', 'lab', 'exp']) { const p = pair(m[k]); if (p) { cm[k + 'Price'] = numToCol(p.price); cm[k + 'Amt'] = numToCol(p.amt); } }
  cm.firstRow = headerRow + (/단가|금액/.test(sub(m.mat)) ? 2 : 1);
  return cm;
}

const refsInSheet = (f, col) => {
  if (!f) return [];
  const out = [];
  for (const m of f.matchAll(/(?<![!A-Za-z가-힣_'])\$?([A-Z]{1,3})\$?(\d+)(?!\d|\s*!)/g)) if (m[1] === col) out.push(+m[2]);
  return out;
};
const crossSheet = (f) => !!f && /!/.test(f);
const isMulQty = (f, priceCol, qtyCol) => !!f && new RegExp(`\\b${priceCol}\\d+\\s*\\*\\s*${qtyCol}\\d+|\\b${qtyCol}\\d+\\s*\\*\\s*${priceCol}\\d+`).test(f);

/** 항목 트리 만들기. ev: Evaluator (계산값), 반환: { cm, items, totals, maxRow } */
export function parseBoq(model, ev, sheet, headerRow) {
  const s = model.sheet(sheet);
  const cm = columnMap(model, sheet, headerRow);
  let maxRow = 0; for (const a of s.cells.keys()) maxRow = Math.max(maxRow, +a.replace(/^[A-Z]+/, ''));
  const val = (col, r) => (col ? ev.value(sheet, col + r) : null);
  const num = (col, r) => { const v = val(col, r); return typeof v === 'number' ? v : null; };
  const f = (col, r) => (col ? ev.formula(sheet, col + r) : null);

  const items = [];
  let section = 'summary';
  let blankRun = 0;
  for (let r = cm.firstRow; r <= maxRow; r++) {
    const rawName = val(cm.name, r);
    const name = rawName == null ? '' : String(rawName);
    const amts = ['mat', 'lab', 'exp'].map((k) => num(cm[k + 'Amt'], r) || 0);
    const hasAny = name.trim() || amts.some((x) => x) || num(cm.qty, r) != null;
    if (!hasAny) { blankRun++; if (items.length && section === 'summary' && blankRun >= 1) section = 'detail'; continue; }
    blankRun = 0;
    const matF = f(cm.matAmt, r), labF = f(cm.labAmt, r), expF = f(cm.expAmt, r);
    const priceF = f(cm.matPrice, r) || f(cm.labPrice, r) || f(cm.expPrice, r);
    const anyMul = isMulQty(matF, cm.matPrice, cm.qty) || isMulQty(labF, cm.labPrice, cm.qty) || isMulQty(expF, cm.expPrice, cm.qty);
    let kind, children = [];
    if (anyMul) kind = priceF && !crossSheet(priceF) && refsInSheet(priceF, cm.matAmt).length + refsInSheet(priceF, cm.labAmt).length + refsInSheet(priceF, cm.expAmt).length > 0 ? 'link' : 'item';
    else {
      children = [...new Set([...refsInSheet(matF, cm.matAmt), ...refsInSheet(labF, cm.labAmt), ...refsInSheet(expF, cm.expAmt)])].filter((x) => x > r);
      kind = children.length && !/[*/]/.test(((matF || '') + (labF || '') + (expF || '')).replace(/ROUND\([^)]*\)/g, '')) ? 'group' : 'cost';
    }
    const lead = name.match(/^\s*/)[0].length;
    items.push({
      row: r, kind, section, name: name.trim(), indent: lead,
      spec: cm.spec ? (val(cm.spec, r) ?? '') + '' : '', unit: (val(cm.unit, r) ?? '') + '', qty: num(cm.qty, r),
      mat_price: num(cm.matPrice, r), lab_price: num(cm.labPrice, r), exp_price: num(cm.expPrice, r),
      mat_amt: amts[0], lab_amt: amts[1], exp_amt: amts[2], total_amt: amts[0] + amts[1] + amts[2],
      note: cm.note ? (val(cm.note, r) ?? '') + '' : '',
      price_ref: priceF || null, amt_formula: (kind === 'cost' ? (expF || labF || matF) : null) || null, children,
    });
  }
  // 부모 연결: 소계가 가리키는 행. 소계끼리 중첩되면 가장 가까운(아래쪽) 소계가 부모
  const byRow = new Map(items.map((it) => [it.row, it]));
  for (const g of items.filter((x) => x.kind === 'group').sort((a, b) => b.row - a.row))
    for (const c of g.children) { const it = byRow.get(c); if (it && it.parent_row == null) it.parent_row = g.row; }
  // 하위 소계를 건너뛰고 공종을 직접 더하는 소계(예: 1.신궁1육교 = 34+35+…)도 하위 소계의 부모가 되게
  const desc = (g) => { const out = new Set(); const st = [...g.children]; while (st.length) { const x = st.pop(); if (out.has(x)) continue; out.add(x); const it = byRow.get(x); if (it?.kind === 'group') st.push(...it.children); } return out; };
  const groups = items.filter((x) => x.kind === 'group');
  for (const g of groups) {
    if (g.parent_row != null) continue;
    const mine = desc(g);
    const p = groups.filter((x) => x.row < g.row && x.children.some((c) => mine.has(c))).sort((a, b) => b.row - a.row)[0];
    if (p) g.parent_row = p.row;
  }
  // 단계(level): 부모 따라 올라간 수
  for (const it of items) { let d = 0, p = it.parent_row; while (p != null && d < 20) { d++; p = byRow.get(p)?.parent_row; } it.level = d; }
  // 원가계산서 핵심 줄 찾기
  const key = (re) => items.find((x) => x.section === 'summary' && re.test(norm(x.name)));
  const pick = (re) => { const it = key(re); return it ? { row: it.row, amount: it.total_amt } : null; };
  const totals = {
    direct: pick(/직접공사비/), net: pick(/순공사비/), overhead: pick(/일반관리비/), profit: pick(/이윤/),
    supply: pick(/공급가액/), vat: pick(/부가가치세/), contract: pick(/도급(예정)?액/), govMaterial: pick(/관급자재비/), grand: pick(/총공사비/),
  };
  return { cm, items, totals, maxRow };
}

/** 원가계산서(요약부)에서 법정 경비라 보통 '설계 금액 고정'하는 줄 */
export const DEFAULT_FIXED = /(건강보험|연금보험|노인장기요양|산업안전보건관리비|퇴직공제)/;
